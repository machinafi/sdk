/**
 * [[ Description ]]
 * This is a limit buy order contract for ERG and TOKEN with partial filling support. It allows users 
 * to buy tokens at a predefined price, with the contract accumulating ERG until the order is fully 
 * filled. Upon completion, the accumulated funds are transferred to the order owner (R4). 
 *
 * [[ Registers ]]
 * R4: SigmaProp           Owner script, only supports ErgoTree v0
 * R5: Long                Price in nanoergs
 * R6: Coll[Byte]          Spent input ID, prevents spending multiple inputs with a single output
 *
 * [[ Tokens ]]
 * 0: QuoteToken?          The quote token, can be empty
 *
 * [[ Context variables ]]
 * 0: Int                  Recreated output index
 *
 * [[ Expected actions ]]
 * Buy                     Buy tokens with ERG at predefined price
 * Close                   Close the order and withdrawal assets
 */
{
  val T = 0; // token index
  val TOKEN_ID = fromBase16("cafe05e06b54b00eb0067c7c5e900c4d394030f4ac2e351f873a28f6158ced6e");
  val EMPTY_TOKEN = (TOKEN_ID, 0L);

  val owner = SELF.R4[SigmaProp].get;
  val price = SELF.R5[Long].get; // buy price in nanoergs
  
  val childBoxIndex = getVar[Int](1);
  val buying = childBoxIndex.isDefined;

  if (buying) {
    // ======================================= //
    // The user is BUYING tokens with nanoergs //
    // Asset flow: nanoergs IN, tokens OUT     //
    // ======================================= //

    val childBox = OUTPUTS(childBoxIndex.get);

    val selfToken = SELF.tokens(T); // self will always contain tokens
    val childToken = childBox.tokens.getOrElse(T, EMPTY_TOKEN); // child tokens can be empty if order is fully filled
    val selfTokenAmount = selfToken._2;
    val childTokenAmount = childToken._2;

    // if the child box still contains tokens, it must preserve the state and accumulate ERG in it
    val validRecreation = if (childTokenAmount > 0L) {      
                                                            // should be true if:
      childBox.propositionBytes == SELF.propositionBytes && // 1. preserve proposition
      childToken._1 == TOKEN_ID &&                          // 2. preserve token ID, if any
      childBox.R4[SigmaProp].get == owner &&                // 3. preserve owner script
      childBox.R5[Long].get == price &&                     // 4. preserve price
      childBox.R6[Coll[Byte]].get == SELF.id                // 5. bind the child to the parent box
    } else { // if the child box contains no tokens, funds must be sent to the owner
      childBox.propositionBytes == owner.propBytes
    }

    val validExchange = {
      val nanoergsIn = childBox.value - SELF.value;       // nanoergs received from the buyer
      val tokensOut = selfTokenAmount - childTokenAmount; // tokens paid out to the buyer
      val requiredNanoergs = tokensOut * price;           // nanoergs covering the token price

      val validBuy =                    // should be true if:
        nanoergsIn > 0L &&              // 1. the incoming nanoergs amount is positive
        nanoergsIn >= requiredNanoergs; // 2. the nanoergs are enough to cover the token price

      validBuy                          // return the result of the buy validation
    }

    sigmaProp(validRecreation && validExchange)
  } else {
    // ============================= //
    // The user is CLOSING the order //
    // ============================= //

    owner
  }
}
