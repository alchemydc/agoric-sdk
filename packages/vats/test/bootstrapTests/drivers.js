import { unmarshalFromVstorage } from '@agoric/internal/src/lib-chainStorage.js';
import { slotToRemotable } from '@agoric/internal/src/storage-test-utils.js';
import { boardSlottingMarshaller } from '../../tools/board-utils.js';

/**
 * @param {ReturnType<typeof makeRunUtils>} runUtils
 * @param {import('@agoric/internal/src/storage-test-utils.js').FakeStorageKit} storage
 * @param {import('../../tools/board-utils.js').AgoricNamesRemotes} agoricNamesRemotes
 */
export const makeWalletFactoryDriver = async (
  runUtils,
  storage,
  agoricNamesRemotes,
) => {
  const { EV } = runUtils;

  const walletFactoryStartResult = await EV.vat('bootstrap').consumeItem(
    'walletFactoryStartResult',
  );
  const bankManager = await EV.vat('bootstrap').consumeItem('bankManager');
  const namesByAddressAdmin = await EV.vat('bootstrap').consumeItem(
    'namesByAddressAdmin',
  );

  const marshaller = boardSlottingMarshaller(slotToRemotable);

  /**
   * @param {string} walletAddress
   * @param {import('@agoric/smart-wallet/src/smartWallet.js').SmartWallet} walletPresence
   * @param {boolean} isNew
   */
  const makeWalletDriver = (walletAddress, walletPresence, isNew) => ({
    isNew,

    /**
     * @param {import('@agoric/smart-wallet/src/offers.js').OfferSpec} offer
     * @returns {Promise<void>}
     */
    executeOffer(offer) {
      const offerCapData = marshaller.toCapData(
        harden({
          method: 'executeOffer',
          offer,
        }),
      );
      return EV(walletPresence).handleBridgeAction(offerCapData, true);
    },
    /**
     * @param {import('@agoric/smart-wallet/src/offers.js').OfferSpec} offer
     * @returns {Promise<void>}
     */
    sendOffer(offer) {
      const offerCapData = marshaller.toCapData(
        harden({
          method: 'executeOffer',
          offer,
        }),
      );

      return EV.sendOnly(walletPresence).handleBridgeAction(offerCapData, true);
    },
    tryExitOffer(offerId) {
      const capData = marshaller.toCapData(
        harden({
          method: 'tryExitOffer',
          offerId,
        }),
      );
      return EV(walletPresence).handleBridgeAction(capData, true);
    },
    /**
     * @template {(brands: Record<string, Brand>, ...rest: any) => import('@agoric/smart-wallet/src/offers.js').OfferSpec} M offer maker function
     * @param {M} makeOffer
     * @param {Parameters<M>[1]} firstArg
     * @param {Parameters<M>[2]} [secondArg]
     * @returns {Promise<void>}
     */
    executeOfferMaker(makeOffer, firstArg, secondArg) {
      const offer = makeOffer(agoricNamesRemotes.brand, firstArg, secondArg);
      return this.executeOffer(offer);
    },
    /**
     * @template {(brands: Record<string, Brand>, ...rest: any) => import('@agoric/smart-wallet/src/offers.js').OfferSpec} M offer maker function
     * @param {M} makeOffer
     * @param {Parameters<M>[1]} firstArg
     * @param {Parameters<M>[2]} [secondArg]
     * @returns {Promise<void>}
     */
    sendOfferMaker(makeOffer, firstArg, secondArg) {
      const offer = makeOffer(agoricNamesRemotes.brand, firstArg, secondArg);
      return this.sendOffer(offer);
    },

    /**
     * @returns {import('@agoric/smart-wallet/src/smartWallet.js').CurrentWalletRecord}
     */
    getCurrentWalletRecord() {
      const fromCapData = (...args) =>
        Reflect.apply(marshaller.fromCapData, marshaller, args);
      return unmarshalFromVstorage(
        storage.data,
        `published.wallet.${walletAddress}.current`,
        fromCapData,
      );
    },

    /**
     * @returns {import('@agoric/smart-wallet/src/smartWallet.js').UpdateRecord}
     */
    getLatestUpdateRecord() {
      const fromCapData = (...args) =>
        Reflect.apply(marshaller.fromCapData, marshaller, args);
      return unmarshalFromVstorage(
        storage.data,
        `published.wallet.${walletAddress}`,
        fromCapData,
      );
    },
  });

  return {
    /**
     * @param {string} walletAddress
     * @returns {Promise<ReturnType<typeof makeWalletDriver>>}
     */
    async provideSmartWallet(walletAddress) {
      const bank = await EV(bankManager).getBankForAddress(walletAddress);
      return EV(walletFactoryStartResult.creatorFacet)
        .provideSmartWallet(walletAddress, bank, namesByAddressAdmin)
        .then(([walletPresence, isNew]) =>
          makeWalletDriver(walletAddress, walletPresence, isNew),
        );
    },
  };
};
