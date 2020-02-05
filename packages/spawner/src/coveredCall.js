/* global E */
// Copyright (C) 2019 Agoric, under Apache License 2.0

import harden from '@agoric/harden';
import { mustBeSameStructure, sameStructure } from '@agoric/same-structure';

/**
 * The coveredCall is an asymmetric contract. One party will put some goods in
 * escrow, and is transferring the right to buy them for a specified units of
 * some currency. start() specifies the terms, and returns the seat that has the
 * ability to offer() the goods. The counterparty seat is returned from offer(),
 * so the originator can offer it to a someone of their choice. To simplify
 * terminology, the terms refer to 'stock' and 'money', though neither is
 * limited, and the offerer and potential acceptor are 'bob' and 'alice'
 * respectively.
 */
export const makeContract = harden({
  start: (terms, inviteMaker) => {

    function checkUnits(installation, allegedInviteUnits, expectedTerms) {
      mustBeSameStructure(
        allegedInviteUnits.extent.installation,
        installation,
        'coveredCall checkUnits installation',
      );
      const [termsMoney, termsStock, termsTimer, termsDeadline] = expectedTerms;
      const allegedInviteTerms = allegedInviteUnits.extent.terms;
      const allegedInviteMoney = allegedInviteTerms.money;
      if (allegedInviteMoney.extent !== termsMoney.extent) {
        throw new Error(
          `Wrong money extent: ${allegedInviteMoney.extent}, expected ${termsMoney.extent}`,
        );
      }
      if (!sameStructure(allegedInviteMoney, termsMoney)) {
        throw new Error(
          `money terms incorrect: ${allegedInviteMoney}, expected ${termsMoney}`,
        );
      }
      const allegedInviteStock = allegedInviteTerms.stock;
      if (!sameStructure(allegedInviteStock, termsStock)) {
        throw new Error(
          `right terms incorrect: ${allegedInviteStock}, expected ${termsStock}`,
        );
      }
      if (allegedInviteTerms.deadline !== termsDeadline) {
        throw new Error(
          `Wrong deadline: ${allegedInviteTerms.deadline}, expected ${termsDeadline}`,
        );
      }
      if (termsTimer !== allegedInviteTerms.timer) {
        throw new Error(
          `Wrong timer: ${allegedInviteTerms.timer}, expected ${termsTimer}`,
        );
      }
      return true;
    }

    const {
      escrowExchangeInstallation: escrowExchangeInstallationP,
      money: moneyNeeded,
      stock: stockNeeded,
      timer: timerP,
      deadline,
    } = terms;

    const exchangeables = harden({ left: moneyNeeded, right: stockNeeded });
    return escrowExchangeInstallationP
      ~.spawn(exchangeables)
      .then(({ rootObject, adminNode }) => {
        const aliceEscrowSeatP = rootObject
          ~.left()
          .then(inviteP => inviteMaker~.redeem(inviteP));
        const bobEscrowSeatP = rootObject
          ~.right()
          .then(inviteP => inviteMaker~.redeem(inviteP));

        // Seats

        const canceller = {
          wake: () => {
            bobEscrowSeatP~.cancel('expired');
          },
        };

        timerP~.setWakeup(deadline, canceller);

        const bobSeat = harden({
          offer(stockPayment) {
            const sAssay = stockNeeded.label.assay;
            return sAssay
              ~.claimExactly(stockNeeded, stockPayment, 'prePay')
              .then(prePayment => {
                bobEscrowSeatP~.offer(prePayment);
                return inviteMaker~.make('holder', aliceEscrowSeatP);
              });
          },
          getWinnings() {
            return bobEscrowSeatP~.getWinnings();
          },
          getRefund() {
            return bobEscrowSeatP~.getRefund();
          },
        });

        const bobInvite = inviteMaker~.make('writer', bobSeat);
        const checkerInvite = inviteMaker~.make('checker', harden({ checkUnits }));
        return harden({
          bob: () => bobInvite,
          checker: () => checkerInvite,
        });
      });
  },
});
