{
  /**
   * [[ Description ]]
   * This is an auto-compounding two-way grid order contract for BASE and QUOTE tokens. It allows 
   * users to create grid orders to simultaneously buy and sell tokens at predefined prices.
   *
   * [[ Registers ]]
   * R4: SigmaProp           Owner script
   * R5: Coll[Long]          [buy, sell] prices in quote token units
   * R6: Coll[Byte]          Spent input ID, prevents spending multiple inputs with a single output
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
  
  // indexes
  val BASE  = 0; // base token index
  val QUOTE = 1; // quote token index
  val BUY  = 0; // buy price and limit index
  val SELL = 1; // sell price and limit index

  val baseTokenId =  fromBase16("0000000000000000000000000000000000000000000000000000000000000000");
  val quoteTokenId = fromBase16("0000000000000000000000000000000000000000000000000000000000000001");

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
    
    val selfBaseAmount = if (SELF.tokens.size > 0) { SELF.tokens(BASE)._2 } else { 0L };
    val selfQuoteAmount = if (SELF.tokens.size > 1) { SELF.tokens(QUOTE)._2 } else { 0L };
    val childBaseAmount = if (childBox.tokens.size > 0) { childBox.tokens(BASE)._2 } else { 0L };
    val childQuoteAmount = if (childBox.tokens.size > 1) { childBox.tokens(QUOTE)._2 } else { 0L };

    val validBaseTokenId = if (childBox.tokens.size > 0) { childBox.tokens(BASE)._1 == baseTokenId } else { true };
    val validQuoteTokenId = if (childBox.tokens.size > 1) { childBox.tokens(QUOTE)._1 == quoteTokenId } else { true };
    val validRecreation =                                   // should be true if:
      childBox.propositionBytes == SELF.propositionBytes && // 1. preserve proposition
      childBox.value == SELF.value &&                       // 2. preserve nanoergs value
      validBaseTokenId &&                                  // 3. preserve base token ID
      validQuoteTokenId &&                                 // 4. preserve quote token ID
      childBox.R4[SigmaProp].get == owner &&                // 3. preserve owner script
      childBox.R5[Coll[Long]].get == prices &&              // 4. preserve prices
      childBox.R6[Coll[Byte]].get == SELF.id                // 5. bind the child to the parent box
    
    val validExchange = if (buying) {
      // ================================================ //
      // The user is BUYING quote tokens with base tokens //
      // Asset flow: base IN, quote OUT                   //
      // ================================================ //
      
      val price = prices(BUY); // buy price in nanoergs

      val baseIn = childBaseAmount - selfBaseAmount;        // nanoergs received from the buyer
      val quoteOut = selfQuoteAmount - childQuoteAmount;    // tokens paid out to the buyer
      val requiredBaseAmount = quoteOut * price;            // nanoergs covering the token price
      
      val validBuy =                                  // should be true if:
        baseIn > 0L &&                                // 1. the incoming nanoergs amount is positive
        baseIn >= requiredBaseAmount;               // 2. the nanoergs are enough to cover the token price
        // childBox.tokens(BASE)._1 == baseTokenId;    // 3. the token ID is valid
        // (selfQuoteAmount == quoteOut ||               // 4.1. no tokens left; or
          // childBox.tokens(QUOTE)._1 == quoteTokenId); // 4.2. else, the token ID is valid
      
      validBuy                                        // return the result of the buy validation
    } else {
      // ================================================ //
      // The user is SELLING quote tokens for base tokens //
      // Asset flow: quote IN, base OUT                   //
      // ================================================ //
      
      val price = prices(SELL); // sell price

      val baseOut = selfBaseAmount - childBaseAmount;          // nanoergs paid out to the seller
      val quoteIn = childQuoteAmount - selfQuoteAmount; // tokens received from the seller
      val minPayout = quoteIn * price;                       // nanoergs covering the token price

      val validSell =                        // should be true if:
        baseOut > 0L &&                  // 1. the nanoergs difference is positive
        minPayout >= baseOut;           // 2. the incoming tokens are enough to cover the nanoergs out
        // childBox.tokens(QUOTE)._1 == baseTokenId;    // 3. the token ID is valid
        // (selfBaseAmount == baseOut ||               // 4.1. no tokens left; or
          // childBox.tokens(BASE)._1 == baseTokenId); // 4.2. else, the token ID is valid

      validSell                              // return the result of the sell validation
    }

    sigmaProp(validRecreation && validExchange)
  } else {
    // ============================= //
    // The user is CLOSING the order //
    // ============================= //
    
    owner
  }
}
