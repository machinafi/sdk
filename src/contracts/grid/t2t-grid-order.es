{
  /**
   * [[ Description ]]
   * This is an auto-compounding two-way grid order contract for BASE and QUOTE tokens. It allows 
   * users to create grid orders to simultaneously buy and sell tokens at predefined prices.
   *
   * [[ Registers ]]
   * R4: SigmaProp           Owner script
   * R5: Coll[Long]          [buy, sell] prices in base token units
   * R6: Coll[Byte]          Spent input ID, prevents spending multiple inputs with a single output
   *
   * [[ Tokens ]]
   * 0: BaseToken            The base token, must contain at least one unit to avoid token misplacement
   * 1: QuoteToken?          The quote token, can be empty
   *
   * [[ Context variables ]]
   * 0: Boolean              Action, true == buy, false == sell
   * 1: Int                  Recreated output index
   *
   * [[ Expected actions ]]
   * Buy                     Buy quote tokens with base tokens at predefined price
   * Sell                    Sell quote tokens for base tokens at predefined price
   * Close                   Close the order and withdrawal assets
   */

  val BASE = 0;  // base token index
  val QUOTE = 1; // quote token index
  val BUY = 0;   // buy price index
  val SELL = 1;  // sell price index
  val QUOTE_TOKEN_ID = fromBase16("cafe05e06b54b00eb0067c7c5e900c4d394030f4ac2e351f873a28f6158ced6e");
  val EMPTY_QUOTE_TOKEN = (QUOTE_TOKEN_ID, 0L);

  val owner = SELF.R4[SigmaProp].get;

  val childBoxIndex = getVar[Int](1);
  val trading = childBoxIndex.isDefined;

  if (trading) {
    // ========================== //
    // The user is TRADING tokens //
    // ========================== //

    val buying = getVar[Boolean](0).get;  // true == buy, false == sell
    val prices = SELF.R5[Coll[Long]].get; // [buy, sell] prices
    val childBox = OUTPUTS(childBoxIndex.get);

    val selfBaseToken = SELF.tokens(BASE);
    val childBaseToken = childBox.tokens(BASE);

    val selfQuoteToken = SELF.tokens.getOrElse(QUOTE, EMPTY_QUOTE_TOKEN);
    val childQuoteToken = childBox.tokens.getOrElse(QUOTE, EMPTY_QUOTE_TOKEN);

    val selfBaseAmount = selfBaseToken._2;
    val selfQuoteAmount = selfQuoteToken._2;
    val childBaseAmount = childBaseToken._2;
    val childQuoteAmount = childQuoteToken._2;

    val validRecreation =                                   // should be true if:
      childBox.propositionBytes == SELF.propositionBytes && // 1. preserve proposition
      childBox.value == SELF.value &&                       // 2. preserve nanoergs value
      selfBaseToken._1 == childBaseToken._1 &&              // 3. preserve base token ID
      childQuoteToken._1 == QUOTE_TOKEN_ID &&               // 4. preserve quote token ID, if any
      childBox.R4[SigmaProp].get == owner &&                // 5. preserve owner script
      childBox.R5[Coll[Long]].get == prices &&              // 6. preserve prices
      childBox.R6[Coll[Byte]].get == SELF.id;               // 7. bind the child to the parent box

    val validExchange = if (buying) {
      // ================================================ //
      // The user is BUYING quote tokens with base tokens //
      // Asset flow: base IN, quote OUT                   //
      // ================================================ //

      val price = prices(BUY);                           // buy price in base token units
      val baseIn = childBaseAmount - selfBaseAmount;     // base tokens received from the buyer
      val quoteOut = selfQuoteAmount - childQuoteAmount; // tokens paid out to the buyer
      val requiredBaseAmount = quoteOut * price;         // base tokens covering the quote token price

      val validBuy =                  // should be true if:
        baseIn > 0L &&                // 1. the incoming base token amount is positive
        baseIn >= requiredBaseAmount; // 2. the base token are enough to cover the quote token price

      validBuy                        // return the result of the buy validation
    } else {
      // ================================================ //
      // The user is SELLING quote tokens for base tokens //
      // Asset flow: quote IN, base OUT                   //
      // ================================================ //

      val price = prices(SELL);                         // sell price in base token units
      val baseOut = selfBaseAmount - childBaseAmount;   // base tokens paid out to the seller
      val quoteIn = childQuoteAmount - selfQuoteAmount; // quote tokens received from the seller
      val minPayout = quoteIn * price;                  // base tokens covering the quote token price

      val validSell =         // should be true if:
        quoteIn > 0L &&       // 1. the base tokens difference is positive
        minPayout >= baseOut; // 2. the incoming quote tokens are enough to cover the base tokens out

      validSell               // return the result of the sell validation
    }

    sigmaProp(validRecreation && validExchange)
  } else {
    // ============================= //
    // The user is CLOSING the order //
    // ============================= //

    owner
  }
}
