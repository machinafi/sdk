{
  /**
   * [[ Description ]]
   * This is an auto-compounding two-way grid order contract for ERG and TOKEN, Allowing users to 
   * create grid orders for buying and selling tokens at the same time at predefined prices, while 
   * supporting auto-compounding to trade all available amounts. This contract also allows the 
   * owner to cancel the order (withdraw funds) at any time.
   *
   * [[ Registers ]]
   * R4: SigmaProp           Owner script
   * R5: Coll[Long]          [buy, sell] prices in nanoergs
   * R6: Coll[Byte]          Spent input ID, prevents spending multiple inputs with a single output
   *
   * [[ Context variables ]]
   * 0: Boolean              Action, true == buy, false = sell
   * 1: Int                  Recreated output index
   *
   * [[ Expected actions ]]
   * Buy
   * Sell
   * Cancel
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
    val selfTokenAmount = if (SELF.tokens.size > 0) { SELF.tokens(T)._2 } else { 0L }

    val validRecreation =                                   // should be true if:
      childBox.propositionBytes == SELF.propositionBytes && // 1. preserve proposition
      childBox.R4[SigmaProp].get == owner &&                // 2. preserve owner script
      childBox.R5[Coll[Long]].get == prices &&              // 3. preserve prices
      childBox.R6[Coll[Byte]].get == SELF.id                // 4. bind the child to the parent box
    
    val validExchange = if (buying) {
      // ======================================= //
      // The user is BUYING tokens with nanoergs //
      // Asset flow: nanoergs IN, tokens OUT     //
      // ======================================= //
      
      val price = prices(BUY); // buy price in nanoergs
      val childTokenAmount = if (childBox.tokens.size > 0) { childBox.tokens(T)._2 } else { 0L }

      val nanoergsIn = childBox.value - SELF.value;         // nanoergs received from the buyer
      val tokensOut = selfTokenAmount - childTokenAmount;   // tokens paid out to the buyer
      val requiredNanoergs = tokensOut * price;             // nanoergs covering the token price
      
      val validBuy =                         // should be true if:
        nanoergsIn > 0L &&                   // 1. the incoming nanoergs amount is positive
        nanoergsIn >= requiredNanoergs &&    // 2. the nanoergs are enough to cover the token price
        (selfTokenAmount == tokensOut ||     // 3.1. no tokens left; or
          childBox.tokens(T)._1 == tokenId); // 3.2. else, the token ID is valid
      
      validBuy                               // return the result of the buy validation
    } else {
      // ======================================= //
      // The user is SELLING tokens for nanoergs //
      // Asset flow: tokens IN, nanoergs OUT     //
      // ======================================= //
      
      val price = prices(SELL); // sell price

      val nanoergsOut = SELF.value - childBox.value;          // nanoergs paid out to the seller
      val tokensIn = childBox.tokens(T)._2 - selfTokenAmount; // tokens received from the seller
      val minPayout = tokensIn * price;                       // nanoergs covering the token price

      val validSell =                        // should be true if:
        nanoergsOut > 0L &&                  // 1. the nanoergs difference is positive
        minPayout >= nanoergsOut &&          // 2. the tokens paid are enough to cover the nanoergs out
        childBox.tokens(T)._1 == tokenId;    // 3. the token ID is valid

      validSell                              // return the result of the sell validation
    }

    sigmaProp(validRecreation && validExchange)
  } else {
    // ================================ //
    // The user is CANCELLING the order //
    // ================================ //
    
    owner
  }
}
