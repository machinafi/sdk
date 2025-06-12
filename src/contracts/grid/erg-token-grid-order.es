{
  /**
   * [[ Description ]]
   * This is an auto-compounding two-way grid order contract for ERG and TOKEN. It allows users to 
   * create grid orders to simultaneously buy and sell tokens at predefined prices.
   *
   * [[ Registers ]]
   * R4: SigmaProp           Owner script
   * R5: Coll[Long]          [buy, sell] prices in nanoergs
   * R6: Coll[Byte]          Spent input ID, prevents spending multiple inputs with a single output
   *
   * [[ Context variables ]]
   * 0: Boolean              Action, true == buy, false == sell
   * 1: Int                  Recreated output index
   *
   * [[ Expected actions ]]
   * Buy                     Buy tokens with ERG at predefined price
   * Sell                    Sell tokens for ERG at predefined price
   * Close                   Close the order and withdrawal assets
   */
  
  // indexes
  val T    = 0; // token index
  val BUY  = 0; // buy price and limit index
  val SELL = 1; // sell price and limit index

  val tokenId = fromBase16("0000000000000000000000000000000000000000000000000000000000000000");
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
    val selfTokenAmount = if (SELF.tokens.size > 0) { SELF.tokens(T)._2 } else { 0L };

    val validTokenId = if (childBox.tokens.size > 0) { childBox.tokens(T)._1 == tokenId } else { true };
    val validRecreation =                                   // should be true if:
      childBox.propositionBytes == SELF.propositionBytes && // 1. preserve proposition
      validTokenId &&                                       // 2. preserve token ID, if any
      childBox.R4[SigmaProp].get == owner &&                // 3. preserve owner script
      childBox.R5[Coll[Long]].get == prices &&              // 4. preserve prices
      childBox.R6[Coll[Byte]].get == SELF.id;               // 5. bind the child to the parent box
    
    val validExchange = if (buying) {
      // ======================================= //
      // The user is BUYING tokens with nanoergs //
      // Asset flow: nanoergs IN, tokens OUT     //
      // ======================================= //
      
      val price = prices(BUY); // buy price in nanoergs
      val childTokenAmount = if (childBox.tokens.size > 0) { childBox.tokens(T)._2 } else { 0L }

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
      
      val price = prices(SELL); // sell price

      val nanoergsOut = SELF.value - childBox.value;          // nanoergs paid out to the seller
      val tokensIn = childBox.tokens(T)._2 - selfTokenAmount; // tokens received from the seller
      val minPayout = tokensIn * price;                       // nanoergs covering the token price

      val validSell =              // should be true if:
        tokensIn > 0L &&           // 1. the incoming tokens is positive
        minPayout >= nanoergsOut;  // 2. the incoming tokens are enough to cover the nanoergs out

      validSell                    // return the result of the sell validation
    }

    sigmaProp(validRecreation && validExchange)
  } else {
    // ============================= //
    // The user is CLOSING the order //
    // ============================= //
    
    owner
  }
}
