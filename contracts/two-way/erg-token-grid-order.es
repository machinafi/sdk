{
  // [ Description ]
  // This is an optionally auto-compounding two-way grid order trading contract for ERG and TOKEN.
  // Allowing users to create grid orders for buying and selling tokens at the same time at predefined 
  // prices [R5], while supporting auto-compounding to trade all available amounts when limits [R6] are 
  // set to zero. This contract also allows the owner to cancel the order (withdraw funds) at any time.
  //
  //
  // [ Registers ]
  //   R4: SigmaProp         - Owner script
  //   R5: Coll[Long]        - [buy, sell] prices in nanoergs
  //   R6: Coll[Long]        - [buy, sell] limits in token units
  //                           - If it's set to zero, the order will be auto-compounded, which 
  //                             means that all the amounts contained in the box can be traded
  //                           - If it's is greater than zero, the order will accumulate assets
  //                             by limiting the amount exchanged amounts
  //   R7: Coll[Byte]        - Spent input ID
  //
  //
  // [ Context variables ]
  //   0: Boolean            - Action, true == buy, false = sell
  //   1: Int                - Recreated output index
  //
  //
  // [ Expected actions ]
  //   - Buy
  //   - Sell
  //   - Cancel the order

  // indexes
  val T = 0;     // token index
  val BUY = 0;   // buy price and limit index
  val SELL = 1;  // sell price and limit index

  // placeholder, replace with actual token ID
  val tokenId = fromBase16("fbbaac7337d051c10fc3da0ccb864f4d32d40027551e1c3ea3ce361f39b91e40");
  val owner = SELF.R4[SigmaProp].get;

  val childBoxIndex = getVar[Int](1);
  val trading = childBoxIndex.isDefined;

  if (trading) {
    // user performs a trade (buy/sell)

    val buying = getVar[Boolean](0).get;   // true == buy, false == sell
    val prices = SELF.R5[Coll[Long]].get;  // [buy, sell] prices
    val limits = SELF.R6[Coll[Long]].get;  // [target, base] max tradeable limits. If zero, no limits
    val selfToken = SELF.tokens(T);
    val childBox = OUTPUTS(childBoxIndex.get);

    val validRecreation = allOf(Coll(                      // should be true if:
      childBox.propositionBytes == SELF.propositionBytes,  // 1. preserve proposition
      childBox.R4[SigmaProp].get == owner,                 // 2. preserve owner script
      childBox.R5[Coll[Long]].get == prices,               // 3. preserve prices
      childBox.R6[Coll[Long]].get == limits,               // 4. preserve limits
      childBox.R7[Coll[Byte]].get == SELF.id               // 5. bind the child box to the parent to
    ));                                                    //    prevent spending multiple inputs with
                                                           //    a single output

    val validExchange = if (buying) {
      // user BUYS tokens with nanoergs (nanoergs IN, tokens OUT)

      val price = prices(BUY); // buy price in nanoergs
      val limit = if (limits(BUY) > 0L) { limits(BUY) } else { selfToken._2 }; // token buy limit
      val childTokenAmount = if (childBox.tokens.size > 0) { childBox.tokens(T)._2 } else { 0L }

      val nanoergsIn = childBox.value - SELF.value;     // nanoergs received from the buyer
      val tokensOut = selfToken._2 - childTokenAmount;  // tokens paid out to the buyer
      val requiredNanoergs = tokensOut * price;         // the required nanoergs to cover the token price

      val validToken = selfToken._2 == tokensOut || childBox.tokens(T)._1 == tokenId;

      allOf(Coll(                        // should be true if:
        nanoergsIn > 0L,                 // 1. the nanoergs difference is positive
        nanoergsIn >= requiredNanoergs,  // 2. the nanoergs paid are enough to cover the token price
        limit >= tokensOut,              // 3. the token amount is within the limit
        validToken                       // 4. the token ID is valid, if there is token change
      ))
    } else {
      // user SELLS tokens for nanoergs (tokens IN, nanoergs OUT)

      val price = prices(SELL); // sell price
      val limit = if (limits(SELL) > 0L) { limits(SELL) } else { selfToken._2 }; // token sell limit

      val nanoergsOut = SELF.value - childBox.value;        // nanoergs paid out to the seller
      val tokensIn = childBox.tokens(T)._2 - selfToken._2;  // tokens received from the seller
      val minPayout = tokensIn * price;                     // the minimum amount of nanoergs to pay out

      allOf(Coll(                         // should be true if:
        nanoergsOut > 0L,                 // 1. the nanoergs difference is positive
        minPayout >= nanoergsOut,         // 2. the tokens paid are enough to cover the nanoergs out
        limit >= tokensIn,                // 3. the token amount is within the limit
        childBox.tokens(T)._1 == tokenId  // 4. the token ID is valid
      ))
    }

    sigmaProp(validRecreation && validExchange)
  } else {
    // user CANCELS THE ORDER (withdrawal funds to the owner script)
    owner
  }
}
