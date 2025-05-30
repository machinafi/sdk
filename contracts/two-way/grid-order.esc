{
  // [ Registers ]
  //   R4: SigmaProp        - Owner script
  //   R5: Coll[Long]       - [buy, sell] prices in nanoergs
  //   R6: Coll[Long]       - [token limit, erg limit], the maximum amount of the asset units to be traded
  //                          - If it's set to zero, the order will be auto compounded, which means that all 
  //                            the amounts contained in the box can be traded
  //                          - If it's is greater than zero, the order will accumulate the corresponding 
  //                            asset by limiting the amount of the corresponding asset that can be traded
  //   R7: Coll[Byte]        - Spent input ID
   
  // [ Context variables ]
  //   0: Boolean            - Action, true == buy, false = sell
  //   1: Int                - Recreated output index

  // [ Expected actions ]
  //   - Buy
  //   - Sell
  //   - Withdrawal

  val tokenId = fromBase16("fbbaac7337d051c10fc3da0ccb864f4d32d40027551e1c3ea3ce361f39b91e40"); // placeholder, replace with actual token ID
  val recreatedOutputIndex = getVar[Int](1);
  val trading = recreatedOutputIndex.isDefined;
  val owner = SELF.R4[SigmaProp].get;

  if (trading) {
    // perform a trade

    val buying = getVar[Boolean](0).get;   // true == buy, false == sell
    val prices = SELF.R5[Coll[Long]].get;  // [buy, sell] prices
    val limits = SELF.R6[Coll[Long]].get;  // [target, base] max tradeable limits, if zero, then no limits (auto-compound)
    val selfToken = SELF.tokens(0);
    val recreatedOutput = OUTPUTS(recreatedOutputIndex.get);

    val validRecreation = allOf(Coll(                              // should be true if:
        recreatedOutput.propositionBytes == SELF.propositionBytes, // 1. preserve proposition
        recreatedOutput.R4[SigmaProp].get == owner,                // 2. preserve owner script
        recreatedOutput.R5[Coll[Long]].get == prices,              // 3. preserve prices
        recreatedOutput.R6[Coll[Long]].get == limits,              // 4. preserve limits
        recreatedOutput.R7[Coll[Byte]].get == SELF.id              // 5. protect from spending multiple inputs with the same output
      )
    );

    val validExchange = if (buying) {
      // buy token with ERG (ERG in, Token out)

      val BUY = 0; // buy index
      val price = prices(BUY); // buy price in nanoergs
      val limit = if (limits(BUY) > 0L) { limits(BUY) } else { selfToken._2 };  // token buy limit

      val nanoergsIn = recreatedOutput.value - SELF.value;          // nanoergs difference between the recreated output and the current box
      val tokensOut = selfToken._2 - recreatedOutput.tokens(0)._2;  // token amount difference between the recreated output and the current box
      val paidAmount = tokensOut * price;                           // the calculated amount of nanoergs that should be paid for the tokens
     
      allOf(Coll(                    // should be true if:
          nanoergsIn > 0L,           // 1. the nanoergs difference is positive
          nanoergsIn >= paidAmount,  // 2. the nanoergs paid are enough to cover the token price
          limit >= tokensOut         // 3. the token amount is within the limit
        )
      )
    } else {
      // sell token for ERG (Token in, ERG out)

      val SELL = 1; // sell index
      val price = prices(SELL); // sell price
      val limit = if (limits(SELL) > 0L) { limits(SELL) } else { selfToken._2 }; // token sell limit

      val nanoergsOut = SELF.value - recreatedOutput.value;        // nanoergs difference between the current box and the recreated output
      val tokensIn = recreatedOutput.tokens(0)._2 - selfToken._2;  // token amount difference between the recreated output and the current box
      val paidAmount = tokensIn * price;                           // the calculated amount of nanoergs that should be paid for the tokens
      
      allOf(Coll(                                  // should be true if:
          nanoergsOut > 0L,                        // 1. the nanoergs difference is positive
          paidAmount >= nanoergsOut,               // 2. the tokens paid are enough to cover the ERG out
          limit >= tokensIn,                       // 3. the token amount is within the limit
          recreatedOutput.tokens(0)._1 == tokenId  // 4. the recreated output contains the target token
        )
      )
    }

    sigmaProp(validRecreation && validExchange)
  } else {
    // withdrawal funds to the owner script
    owner
  }
}
