import { describe } from "bun:test";

const contract = await Bun.file("./contracts/two-way/grid-order.es").text();

describe("contract loading", () => {
  console.log("contract", contract);
});
