/**
 * [[ Description ]]
 * This is a limit order contract for ERG and TOKEN with partial filling support. It allows users
 * to partially or fully buy and sell tokens at a predefined price. Upon completion, the accumulated
 * funds are transferred to the order owner (R4).
 *
 * [[ Registers ]]
 * R4: SigmaProp           Owner script, only supports ErgoTree v0
 * R5: Long                Price in nanoergs
 * R6: Boolean             Order action type, true for buy, false for sell
 * R7: Coll[Byte]          Spent input ID, prevents spending multiple inputs with a single output
 *
 * [[ Tokens ]]
 * 0: QuoteToken?          The quote token, can be empty
 *
 * [[ Context variables ]]
 * 0: Int                  Recreated output index
 *
 * [[ Expected actions ]]
 * Buy                     Buy tokens with ERG at predefined price
 * Sell                    Sell tokens for ERG at predefined price
 * Close                   Close the order and withdrawal assets
 */
{
  val T = 0; // token index
  val TOKEN_ID = fromBase16("cafe05e06b54b00eb0067c7c5e900c4d394030f4ac2e351f873a28f6158ced6e");
  val EMPTY_TOKEN = (TOKEN_ID, 0L);
  val SAFE_MIN_BOX_VALUE = 1000000L;

  val owner = SELF.R4[SigmaProp].get;
  val price = SELF.R5[Long].get;          // price in nanoergs
  val isBuyAction = SELF.R6[Boolean].get; // true if this is a buy order, false if sell order

  val childBoxIndex = getVar[Int](0);
  val isTrading = childBoxIndex.isDefined;

  if (isTrading) {
    val childBox = OUTPUTS(childBoxIndex.get);

    val selfToken = SELF.tokens.getOrElse(T, EMPTY_TOKEN);
    val childToken = childBox.tokens.getOrElse(T, EMPTY_TOKEN);
    val selfTokenAmount = selfToken._2;
    val childTokenAmount = childToken._2;

    val isPartial = if (isBuyAction) { childTokenAmount > 0L } else { childBox.value >= SAFE_MIN_BOX_VALUE };
    val validRecreation = if (isPartial) {
      // =============================== //
      // Partially filling               //
      // Recreate box and preserve state //
      // =============================== //
                                                            // should be true if:
      childBox.propositionBytes == SELF.propositionBytes && // 1. preserve proposition
      childToken._1 == TOKEN_ID &&                          // 2. preserve token ID, if any
      childBox.R4[SigmaProp].get == owner &&                // 3. preserve owner script
      childBox.R5[Long].get == price &&                     // 4. preserve price
      childBox.R6[Boolean].get == isBuyAction &&            // 5. preserve order action type
      childBox.R7[Coll[Byte]].get == SELF.id                // 6. bind the child to the parent box
    } else {
      // =============================== //
      // Fully filling                   //
      // Send funds to the owner         //
      // =============================== //
                                                            // should be true if:
      childBox.propositionBytes == owner.propBytes &&       // 1. funds are sent to the owner
      childBox.R4[Coll[Byte]].get == SELF.id                // 2. bind the child to the parent box
    }

    val validExchange = if (isBuyAction) {
      // ======================================= //
      // The user is BUYING tokens with nanoergs //
      // Asset flow: nanoergs IN, tokens OUT     //
      // ======================================= //

      val nanoergsIn = childBox.value - SELF.value;       // nanoergs received from the buyer
      val tokensOut = selfTokenAmount - childTokenAmount; // tokens paid out to the buyer
      val requiredNanoergs = tokensOut * price;           // nanoergs covering the token price

      val validBuy =                    // should be true if:
        nanoergsIn > 0L &&              // 1. the incoming nanoergs amount is positive
        nanoergsIn >= requiredNanoergs; // 2. the nanoergs are enough to cover the token price

      validBuy                          // return the result of the buy validation
    } else {
      // ======================================= //
      // The user is SELLING tokens for nanoergs //
      // Asset flow: tokens IN, nanoergs OUT     //
      // ======================================= //

      val nanoergsOut = SELF.value - childBox.value;     // nanoergs paid out to the seller
      val tokensIn = childTokenAmount - selfTokenAmount; // tokens received from the seller
      val minPayout = tokensIn * price;                  // nanoergs covering the token price

      val validSell =             // should be true if:
        tokensIn > 0L &&          // 1. the incoming tokens is positive
        minPayout >= nanoergsOut; // 2. the incoming tokens are enough to cover the nanoergs out

      validSell                   // return the result of the sell validation
    }

    sigmaProp(validRecreation && validExchange)
  } else {
    // ============================= //
    // The user is CLOSING the order //
    // ============================= //

    owner
  }
}
