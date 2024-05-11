package vtransfer_test

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"text/template"

	app "github.com/Agoric/agoric-sdk/golang/cosmos/app"
	"github.com/Agoric/agoric-sdk/golang/cosmos/vm"
	"github.com/cosmos/cosmos-sdk/store"
	"github.com/stretchr/testify/suite"
	"github.com/tendermint/tendermint/libs/log"
	dbm "github.com/tendermint/tm-db"

	swingsettesting "github.com/Agoric/agoric-sdk/golang/cosmos/x/swingset/testing"
	swingsettypes "github.com/Agoric/agoric-sdk/golang/cosmos/x/swingset/types"
	vibckeeper "github.com/Agoric/agoric-sdk/golang/cosmos/x/vibc/keeper"

	"github.com/cosmos/cosmos-sdk/baseapp"
	sdk "github.com/cosmos/cosmos-sdk/types"
	authtypes "github.com/cosmos/cosmos-sdk/x/auth/types"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	ibctransfertypes "github.com/cosmos/ibc-go/v6/modules/apps/transfer/types"
	channeltypes "github.com/cosmos/ibc-go/v6/modules/core/04-channel/types"
	ibctesting "github.com/cosmos/ibc-go/v6/testing"
	"github.com/cosmos/ibc-go/v6/testing/simapp"
	tmproto "github.com/tendermint/tendermint/proto/tendermint/types"
)

type IntegrationTestSuite struct {
	suite.Suite

	coordinator *ibctesting.Coordinator

	// testing chains used for convenience and readability
	chainA *ibctesting.TestChain
	chainB *ibctesting.TestChain

	queryClient ibctransfertypes.QueryClient
}

// interBlockCacheOpt returns a BaseApp option function that sets the persistent
// inter-block write-through cache.
func interBlockCacheOpt() func(*baseapp.BaseApp) {
	return baseapp.SetInterBlockCache(store.NewCommitKVStoreCacheManager())
}

type TestingAppMaker func() (ibctesting.TestingApp, map[string]json.RawMessage)

// Each instance has unique IBC genesis state with deterministic
// client/connection/channel sequence numbers
// (respectively, X000/X010/X050 where X is the zero-based
// instance number plus one, such that instance 0 uses
// 1000/1010/1050, instance 1 uses 2000/2010/2050, etc.).
func computeSequences(instance int) (clientSeq, connectionSeq, channelSeq int) {
	baseSequence := 1000 * (instance + 1)
	return baseSequence, baseSequence + 10, baseSequence + 50
}

func SetupAgoricTestingApp(instance int) TestingAppMaker {
	return func() (ibctesting.TestingApp, map[string]json.RawMessage) {
		db := dbm.NewMemDB()
		encCdc := app.MakeEncodingConfig()
		mockController := func(ctx context.Context, needReply bool, jsonRequest string) (jsonReply string, err error) {
			// fmt.Printf("controller %d got: %s\n", instance, jsonRequest)

			// Check that the message is at least JSON.
			var jsonAny interface{}
			if err := json.Unmarshal([]byte(jsonRequest), &jsonAny); err != nil {
				panic(err)
			}

			// Our reply must be truthy or else we don't make it past AG_COSMOS_INIT.
			jsonReply = `true`
			return jsonReply, nil
		}
		appd := app.NewAgoricApp(mockController, vm.NewAgdServer(), log.TestingLogger(), db, nil,
			true, map[int64]bool{}, app.DefaultNodeHome, simapp.FlagPeriodValue, encCdc, simapp.EmptyAppOptions{}, interBlockCacheOpt())
		genesisState := app.NewDefaultGenesisState()

		t := template.Must(template.New("").Parse(`
		{
				"client_genesis": {
						"clients": [],
						"clients_consensus": [],
						"clients_metadata": [],
						"create_localhost": false,
						"next_client_sequence": "{{.nextClientSequence}}",
						"params": {
								"allowed_clients": [
										"06-solomachine",
										"07-tendermint"
								]
						}
				},
				"connection_genesis": {
						"client_connection_paths": [],
						"connections": [],
						"next_connection_sequence": "{{.nextConnectionSequence}}",
						"params": {
								"max_expected_time_per_block": "30000000000"
						}
				},
				"channel_genesis": {
						"ack_sequences": [],
						"acknowledgements": [],
						"channels": [],
						"commitments": [],
						"next_channel_sequence": "{{.nextChannelSequence}}",
						"receipts": [],
						"recv_sequences": [],
						"send_sequences": []
				}
		}`))
		var result strings.Builder
		clientSeq, connectionSeq, channelSeq := computeSequences(instance)
		t.Execute(&result, map[string]any{
			"nextClientSequence":     clientSeq,
			"nextConnectionSequence": connectionSeq,
			"nextChannelSequence":    channelSeq,
		})
		genesisState["ibc"] = json.RawMessage(result.String())
		return appd, genesisState
	}
}

func TestKeeperTestSuite(t *testing.T) {
	suite.Run(t, new(IntegrationTestSuite))
}

func (s *IntegrationTestSuite) SetupTest() {
	s.coordinator = ibctesting.NewCoordinator(s.T(), 0)

	chains := make(map[string]*ibctesting.TestChain)
	for i := 0; i < 2; i++ {
		ibctesting.DefaultTestingAppInit = SetupAgoricTestingApp(i)

		// create a chain with the temporary coordinator that we'll later override
		chainID := ibctesting.GetChainID(i)
		chain := ibctesting.NewTestChain(s.T(), ibctesting.NewCoordinator(s.T(), 0), chainID)

		balance := banktypes.Balance{
			Address: chain.SenderAccount.GetAddress().String(),
			Coins:   sdk.NewCoins(sdk.NewCoin(sdk.DefaultBondDenom, sdk.NewInt(100000000000000))),
		}

		// create application and override files in the IBC test chain
		app := ibctesting.SetupWithGenesisValSet(
			s.T(),
			chain.Vals,
			[]authtypes.GenesisAccount{
				chain.SenderAccount.(authtypes.GenesisAccount),
			},
			chainID,
			sdk.DefaultPowerReduction,
			balance,
		)

		chain.App = app
		chain.QueryServer = app.GetIBCKeeper()
		chain.TxConfig = app.GetTxConfig()
		chain.Codec = app.AppCodec()
		chain.CurrentHeader = tmproto.Header{
			ChainID: chainID,
			Height:  1,
			Time:    s.coordinator.CurrentTime.UTC(),
		}

		chain.Coordinator = s.coordinator
		s.coordinator.CommitBlock(chain)

		chains[chainID] = chain
	}

	s.coordinator.Chains = chains
	s.chainA = s.coordinator.GetChain(ibctesting.GetChainID(0))
	s.chainB = s.coordinator.GetChain(ibctesting.GetChainID(1))

	agoricApp := s.GetApp(s.chainA)

	queryHelper := baseapp.NewQueryServerTestHelper(s.chainA.GetContext(), agoricApp.InterfaceRegistry())
	ibctransfertypes.RegisterQueryServer(queryHelper, agoricApp.TransferKeeper)
	s.queryClient = ibctransfertypes.NewQueryClient(queryHelper)
}

func (s *IntegrationTestSuite) GetApp(chain *ibctesting.TestChain) *app.GaiaApp {
	app, ok := chain.App.(*app.GaiaApp)
	if !ok {
		panic("not agoric app")
	}

	return app
}

func (s *IntegrationTestSuite) NewTransferPath() *ibctesting.Path {
	path := ibctesting.NewPath(s.chainA, s.chainB)
	_, _, channelASeq := computeSequences(0)
	_, _, channelBSeq := computeSequences(1)
	path.EndpointA.ChannelID = fmt.Sprintf("channel-%d", channelASeq)
	path.EndpointB.ChannelID = fmt.Sprintf("channel-%d", channelBSeq)
	path.EndpointA.ChannelConfig.PortID = ibctesting.TransferPort
	path.EndpointB.ChannelConfig.PortID = ibctesting.TransferPort
	path.EndpointA.ChannelConfig.Version = "ics20-1"
	path.EndpointB.ChannelConfig.Version = "ics20-1"

	s.coordinator.Setup(path)

	s.coordinator.CommitBlock(s.chainA, s.chainB)

	return path
}

func (s *IntegrationTestSuite) SetupContract() *ibctesting.Path {
	path := ibctesting.NewPath(s.chainA, s.chainB)
	_, _, channelASeq := computeSequences(0)
	_, _, channelBSeq := computeSequences(1)
	path.EndpointA.ChannelID = fmt.Sprintf("channel-%d", channelASeq)
	path.EndpointB.ChannelID = fmt.Sprintf("channel-%d", channelBSeq)
	path.EndpointA.ChannelConfig.PortID = ibctesting.TransferPort
	path.EndpointB.ChannelConfig.PortID = ibctesting.TransferPort
	path.EndpointA.ChannelConfig.Version = "ics20-1"
	path.EndpointB.ChannelConfig.Version = "ics20-1"

	s.coordinator.Setup(path)

	s.coordinator.CommitBlock(s.chainA, s.chainB)

	return path
}

func (s *IntegrationTestSuite) checkQueue(records []string, expected []swingsettypes.InboundQueueRecord) {
	exLen := len(expected)
	recLen := len(records)
	maxLen := exLen
	if recLen > maxLen {
		maxLen = recLen
	}
	for i := 0; i < maxLen; i++ {
		if i >= recLen {
			s.Fail("expected record", "%d: %q", i, expected[i])
			continue
		} else if i >= exLen {
			s.Fail("unexpected record", "%d: %v", i, records[i])
			continue
		}
		expi := expected[i]
		var reci swingsettypes.InboundQueueRecord
		err := json.Unmarshal([]byte(records[i]), &reci)
		s.Require().NoError(err)

		if expi.Context.TxHash == "" {
			// Default the TxHash.
			expi.Context.TxHash = reci.Context.TxHash
		}

		// Comparing unmarshaled values with an inlined object fails.
		// So we marshal the expected object and compare the strings.
		expbz, err := json.Marshal(expi)
		s.Require().NoError(err)

		s.Equal(string(expbz), records[i])
	}
}

func (s *IntegrationTestSuite) RegisterBridgeTarget(chain *ibctesting.TestChain, target string) {
	agdServer := s.GetApp(chain).AgdServer
	defer agdServer.SetControllerContext(chain.GetContext())()
	var reply string
	err := agdServer.ReceiveMessage(
		&vm.Message{
			Port: agdServer.GetPort("vtransfer"),
			Data: `{"type":"BRIDGE_TARGET_REGISTER","target":"` + target + `"}`,
		},
		&reply,
	)
	s.Require().NoError(err)
	s.Require().Equal(reply, "true")
}

func (s *IntegrationTestSuite) TransferFromSourceChain(
	srcChain *ibctesting.TestChain,
	data ibctransfertypes.FungibleTokenPacketData,
	src, dst *ibctesting.Endpoint,
) (channeltypes.Packet, error) {
	tokenAmt, ok := sdk.NewIntFromString(data.Amount)
	s.Require().True(ok)

	timeoutHeight := srcChain.GetTimeoutHeight()
	packet := channeltypes.NewPacket(data.GetBytes(), 0, src.ChannelConfig.PortID, src.ChannelID, dst.ChannelConfig.PortID, dst.ChannelID, timeoutHeight, 0)

	// send a transfer packet from src
	imt := ibctransfertypes.MsgTransfer{
		SourcePort:       packet.SourcePort,
		SourceChannel:    packet.SourceChannel,
		Memo:             data.Memo,
		Token:            sdk.NewCoin(data.Denom, tokenAmt),
		Sender:           data.Sender,
		Receiver:         data.Receiver,
		TimeoutHeight:    packet.TimeoutHeight,
		TimeoutTimestamp: packet.TimeoutTimestamp,
	}
	imr, err := s.GetApp(srcChain).TransferKeeper.Transfer(srcChain.GetContext(), &imt)
	s.Require().NoError(err)
	packet.Sequence = imr.Sequence

	return packet, nil
}

// TestTransferFromAgdToAgd relays an IBC transfer initiated from a chain A to a
// chain B, and relays the chain B's resulting acknowledgement in return. It
// verifies that the source and destination accounts' bridge targets are called
// by inspecting their resulting actionQueue records.  By committing blocks
// between actions, the test verifies that the VM results are permitted to be
// async across blocks.
func (s *IntegrationTestSuite) TestTransferFromAgdToAgd() {
	path := s.NewTransferPath()
	s.Require().Equal(path.EndpointA.ChannelID, "channel-1050")

	s.Run("TransferFromAgdToAgd", func() {
		// create a transfer packet's data contents
		transferData := ibctransfertypes.NewFungibleTokenPacketData(
			"uosmo",
			"1000000",
			s.chainA.SenderAccount.GetAddress().String(),
			s.chainB.SenderAccounts[1].SenderAccount.GetAddress().String(),
			`"This is a JSON memo"`,
		)

		// Register the sender and receiver as bridge targets on their specific
		// chain.
		s.RegisterBridgeTarget(s.chainA, transferData.Sender)
		s.RegisterBridgeTarget(s.chainB, transferData.Receiver)

		tokenAmt, ok := sdk.NewIntFromString(transferData.Amount)
		s.Require().True(ok)

		// Whale up the sender account with the amount to be transferred.
		amount, err := strconv.ParseInt(transferData.Amount, 10, 64)
		s.Require().NoError(err)
		coins := sdk.NewCoins(sdk.NewCoin(transferData.Denom, tokenAmt.Mul(sdk.NewInt(amount))))
		err = s.GetApp(s.chainA).BankKeeper.MintCoins(s.chainA.GetContext(), ibctransfertypes.ModuleName, coins)
		s.Require().NoError(err)
		err = s.GetApp(s.chainA).BankKeeper.SendCoinsFromModuleToAccount(s.chainA.GetContext(), ibctransfertypes.ModuleName, s.chainA.SenderAccount.GetAddress(), coins)
		s.Require().NoError(err)

		// Ensure we have the coins we need
		balances := s.GetApp(s.chainA).BankKeeper.GetAllBalances(s.chainA.GetContext(), s.chainA.SenderAccount.GetAddress())
		s.Require().Equal(coins[0], balances[1])

		// Initiate the transfer
		packet, err := s.TransferFromSourceChain(s.chainA, transferData, path.EndpointA, path.EndpointB)
		s.Require().NoError(err)

		// Relay the packet
		s.coordinator.CommitBlock(s.chainA)
		err = path.EndpointB.UpdateClient()
		s.Require().NoError(err)
		s.coordinator.CommitBlock(s.chainB)

		writeAcknowledgementHeight := s.chainB.CurrentHeader.Height
		writeAcknowledgementTime := s.chainB.CurrentHeader.Time.Unix()

		err = path.EndpointB.RecvPacket(packet)
		s.Require().NoError(err)

		// Create a success ack as defined by ICS20.
		ack := channeltypes.NewResultAcknowledgement([]byte{1})
		// Create a different ack to show that a contract can change it.
		contractAck := channeltypes.NewResultAcknowledgement([]byte{5})

		s.coordinator.CommitBlock(s.chainA, s.chainB)
		{
			records, err := swingsettesting.GetActionQueueRecords(
				s.T(),
				s.chainA.GetContext(),
				s.GetApp(s.chainA).SwingSetKeeper,
			)
			s.Require().NoError(err)
			expected := []swingsettypes.InboundQueueRecord{}
			s.checkQueue(records, expected)
		}

		{
			records, err := swingsettesting.GetActionQueueRecords(
				s.T(),
				s.chainB.GetContext(),
				s.GetApp(s.chainB).SwingSetKeeper,
			)
			s.Require().NoError(err)

			expected := []swingsettypes.InboundQueueRecord{
				{
					Action: &vibckeeper.WriteAcknowledgementEvent{
						ActionHeader: &vm.ActionHeader{
							Type:        "VTRANSFER_IBC_EVENT",
							BlockHeight: writeAcknowledgementHeight,
							BlockTime:   writeAcknowledgementTime,
						},
						Event:           "writeAcknowledgement",
						Target:          transferData.Receiver,
						Packet:          packet,
						Acknowledgement: ack.Acknowledgement(),
					},
					Context: swingsettypes.ActionContext{
						BlockHeight: writeAcknowledgementHeight,
						// TxHash is filled in below
						MsgIdx: 0,
					},
				},
			}

			s.checkQueue(records, expected)

			// write out a different acknowledgement from the "contract", one block later.
			s.coordinator.CommitBlock(s.chainB)
			err = s.GetApp(s.chainB).VtransferKeeper.ReceiveWriteAcknowledgement(s.chainB.GetContext(), packet, contractAck)
			s.Require().NoError(err)

			s.coordinator.CommitBlock(s.chainB)
		}

		// Update Client
		err = path.EndpointA.UpdateClient()
		s.Require().NoError(err)

		acknowledgementHeight := s.chainA.CurrentHeader.Height
		acknowledgementTime := s.chainA.CurrentHeader.Time.Unix()

		// Prove the packet's acknowledgement.
		err = path.EndpointA.AcknowledgePacket(packet, contractAck.Acknowledgement())
		s.Require().NoError(err)

		s.coordinator.CommitBlock(s.chainA, s.chainB)

		{
			records, err := swingsettesting.GetActionQueueRecords(
				s.T(),
				s.chainA.GetContext(),
				s.GetApp(s.chainA).SwingSetKeeper,
			)
			s.Require().NoError(err)
			expected := []swingsettypes.InboundQueueRecord{
				{
					Action: &vibckeeper.WriteAcknowledgementEvent{
						ActionHeader: &vm.ActionHeader{
							Type:        "VTRANSFER_IBC_EVENT",
							BlockHeight: acknowledgementHeight,
							BlockTime:   acknowledgementTime,
						},
						Event:           "acknowledgementPacket",
						Target:          transferData.Sender,
						Packet:          packet,
						Acknowledgement: contractAck.Acknowledgement(),
						Relayer:         s.chainA.SenderAccount.GetAddress(),
					},
					Context: swingsettypes.ActionContext{
						BlockHeight: acknowledgementHeight,
						// TxHash is filled in below
						MsgIdx: 0,
					},
				},
			}

			s.checkQueue(records, expected)
		}
	})
}
