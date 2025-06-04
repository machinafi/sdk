import {
  ErgoUnsignedInput,
  estimateMinBoxValue,
  OutputBuilder,
  type R4ToR6Registers
} from "@fleet-sdk/core";
import { SSigmaProp, SGroupElement, SColl, SLong, SByte, SBool, SInt } from "@fleet-sdk/serializer";
import type { GridOrderCreationParams } from "../../types";
import { first, type Box } from "@fleet-sdk/common";

export const ERG_TOKEN_GRID_CONTRACT =
  "19f1020f04000e20fbbaac7337d051c10fc3da0ccb864f4d32d40027551e1c3ea3ce361f39b91e400400040005000400050004000500040004000402050004020500d806d601e30104d602e4c6a70408d603db6308a7d604b27203730000d6058c720402d606730195e67201d805d607b2a5e4720100d608e4c6a70511d609e4c6a70611d60a7203d60b7204d1ed9683050193c27207c2a793e4c672070408720293e4c672070511720893e4c672070611720993e4c67207070ec5a795e4e30001d804d60c99c17207c1a7d60ddb63087207d60e9972059591b1720d73028cb2720d730300027304d60fb272097305009683040191720c730692720c9c720eb27208730700929591720f7308720f7205720eec937205720e938cb2720d730900017206d804d60c99c1a7c17207d60db2db63087207730a00d60e998c720d027205d60fb27209730b009683040191720c730c929c720eb27208730d00720c929591720f730e720f7205720e938c720d0172067202";

/**
 * Factory for constructing ERG <-> Token grid order actions.
 *
 * This factory does not perform parsing or validation; it simply builds
 * output boxes using the provided parameters.
 *
 * Its primary purpose is to decouple the public API from contract tests,
 * offering a flexible and maintainable structure while ensuring that
 * the code remains unit-tested and production-ready.
 */
export const ergTokenGridOrderFactory = {
  create(options: GridOrderCreationParams): OutputBuilder {
    return new OutputBuilder(
      options.assets.nanoerg || estimateMinBoxValue(),
      ERG_TOKEN_GRID_CONTRACT
    )
      .addTokens(options.assets.token)
      .setAdditionalRegisters({
        R4: SSigmaProp(SGroupElement(first(options.owner.getPublicKeys()))),
        R5: SColl(SLong, [options.prices.buy, options.prices.sell]),
        R6: SColl(SLong, [options.max?.buy ?? 0n, options.max?.sell ?? 0n])
      });
  },

  cancel(box: Box<bigint, R4ToR6Registers>): ErgoUnsignedInput {
    return new ErgoUnsignedInput(box);
  },

  buy(
    box: Box<bigint, R4ToR6Registers>,
    amount: bigint,
    price: bigint
  ): [ErgoUnsignedInput, OutputBuilder] {
    const requiredNanoergs = amount * price;

    const input = new ErgoUnsignedInput(box).setContextExtension({
      0: SBool(true), // action, true == buy
      1: SInt(0) // recreated output index, but shoult be updated on transaction build
    });

    const output = OutputBuilder.from(box)
      .setValue(box.value + requiredNanoergs)
      .addTokens([{ tokenId: first(box.assets).tokenId, amount: amount * -1n }]) // fleet will deduct the amount from the tokens
      .setAdditionalRegisters({ R7: SColl(SByte, input.boxId) }); // bind the output to the input box

    return [input, output];
  }
};
