import { describe } from "bun:test";

const contract = await Bun.file("./contracts/two-way/grid-order.esc").text();

describe("contract loading", () => {
  console.log("contract", contract);
});
