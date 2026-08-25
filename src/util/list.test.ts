import { describe, it, expect } from "vitest";
import { itemsOf } from "./list.js";

describe("itemsOf", () => {
  it("extracts listData (the backend ListResponse envelope)", () => {
    expect(itemsOf({ listData: [{ id: "a" }, { id: "b" }], page: 1, pageSize: 10, totalPage: 1, totalItem: 2 }))
      .toEqual([{ id: "a" }, { id: "b" }]);
  });
  it("returns a bare array as-is", () => {
    expect(itemsOf([1, 2, 3])).toEqual([1, 2, 3]);
  });
  it("returns [] for an unrecognized envelope", () => {
    expect(itemsOf({ foo: [1, 2] })).toEqual([]);
    expect(itemsOf(null)).toEqual([]);
    expect(itemsOf(undefined)).toEqual([]);
  });
});
