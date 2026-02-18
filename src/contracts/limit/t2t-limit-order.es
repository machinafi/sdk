/**
 * [[ Description ]]
 * This is a limit order contract for TOKEN and TOKEN with partial filling support. It allows users
 * to partially or fully buy and sell tokens at a predefined price. Upon completion, the accumulated
 * funds are transferred to the order owner (R4).
 *
 * [[ Registers ]]
 * R4: SigmaProp           Owner script, only supports ErgoTree v0
 * R5: Long                Price in base token units
 * R6: Boolean             Order action type, true for buy, false for sell
 * R7: Coll[Byte]          Spent input ID, prevents spending multiple inputs with a single output
 *
 * [[ Tokens ]]
 * 0: BaseToken            The base token, must contain at least one unit to avoid token misplacement
 * 1: QuoteToken?          The quote token, can be empty
 *
 * [[ Context variables ]]
 * 0: Int                  Recreated output index
 *
 * [[ Expected actions ]]
 * Buy                     Buy quote tokens with base tokens at predefined price
 * Sell                    Sell quote tokens for base tokens at predefined price
 * Close                   Close the order and withdrawal assets
 */
{
  val BASE = 0;  // base token index
  val QUOTE = 1; // quote token index
  val QUOTE_TOKEN_ID = fromBase16("cafe05e06b54b00eb0067c7c5e900c4d394030f4ac2e351f873a28f6158ced6e");
  val EMPTY_QUOTE_TOKEN = (QUOTE_TOKEN_ID, 0L);

  val owner = SELF.R4[SigmaProp].get;
  val price = SELF.R5[Long].get;          // price in base token units
  val isBuyAction = SELF.R6[Boolean].get; // true if this is a buy order, false if sell order

  val childBoxIndex = getVar[Int](0);
  val isTrading = childBoxIndex.isDefined;

  if (isTrading) {
    val childBox = OUTPUTS(childBoxIndex.get);

    val selfBaseToken = SELF.tokens(BASE);
    val childBaseToken = childBox.tokens(BASE);

    val selfQuoteToken = SELF.tokens.getOrElse(QUOTE, EMPTY_QUOTE_TOKEN);
    val childQuoteToken = childBox.tokens.getOrElse(QUOTE, EMPTY_QUOTE_TOKEN);

    val selfBaseAmount = selfBaseToken._2;
    val selfQuoteAmount = selfQuoteToken._2;
    val childBaseAmount = childBaseToken._2;
    val childQuoteAmount = childQuoteToken._2;

    val isPartial = if (isBuyAction) { childQuoteAmount > 0L } else { childBaseAmount > 1L };
    val validRecreation = if (isPartial) {
      // =============================== //
      // Partially filling               //
      // Recreate box and preserve state //
      // =============================== //
                                                            // should be true if:
      childBox.propositionBytes == SELF.propositionBytes && // 1. preserve proposition
      childBox.value == SELF.value &&                       // 2. preserve nanoergs value
      selfBaseToken._1 == childBaseToken._1 &&              // 3. preserve base token ID
      childQuoteToken._1 == QUOTE_TOKEN_ID &&               // 4. preserve quote token ID, if any
      childBox.R4[SigmaProp].get == owner &&                // 5. preserve owner script
      childBox.R5[Long].get == price &&                     // 6. preserve price
      childBox.R6[Boolean].get == isBuyAction &&            // 7. preserve order action type
      childBox.R7[Coll[Byte]].get == SELF.id                // 8. bind the child to the parent box
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
      // ==================================================== //
      // The user is BUYING quote tokens with base tokens     //
      // Asset flow: base tokens IN, quote tokens OUT         //
      // ==================================================== //

      val baseIn = childBaseAmount - selfBaseAmount;     // base tokens received from the buyer
      val quoteOut = selfQuoteAmount - childQuoteAmount; // quote tokens paid out to the buyer
      val requiredBaseAmount = quoteOut * price;         // base tokens covering the quote token price

      val validBuy =                    // should be true if:
        baseIn > 0L &&                  // 1. the incoming base token amount is positive
        baseIn >= requiredBaseAmount;   // 2. the base tokens are enough to cover the quote token price

      validBuy                          // return the result of the buy validation
    } else {
      // ==================================================== //
      // The user is SELLING quote tokens for base tokens     //
      // Asset flow: quote tokens IN, base tokens OUT         //
      // ==================================================== //

      val baseOut = selfBaseAmount - childBaseAmount;   // base tokens paid out to the seller
      val quoteIn = childQuoteAmount - selfQuoteAmount; // quote tokens received from the seller
      val minPayout = quoteIn * price;                  // base tokens covering the quote token price

      val validSell =             // should be true if:
        quoteIn > 0L &&           // 1. the incoming quote tokens amount is positive
        minPayout >= baseOut;     // 2. the incoming quote tokens are enough to cover the base tokens out

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
