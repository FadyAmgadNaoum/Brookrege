import { test } from "node:test";
import assert from "node:assert/strict";
import { validateListing, type ListingInput } from "../src/listingRules";

const base: ListingInput = { type: "APARTMENT", transaction: "SALE", sellerType: "RESALE", bedrooms: 3, bathrooms: 2, price: 1_800_000, areaSqm: 140 };
const fields = (i: ListingInput) => validateListing(i).map((e) => e.field);

test("valid resale apartment passes", () => assert.deepEqual(validateListing(base), []));

test("rent allowed only for apartments and shops", () => {
  assert.deepEqual(fields({ ...base, transaction: "RENT", sellerType: null }), []);
  assert.deepEqual(fields({ ...base, type: "SHOP", transaction: "RENT", sellerType: null, bedrooms: null }), []);
  assert.deepEqual(fields({ ...base, type: "VILLA", transaction: "RENT", sellerType: null }), ["type"]);
  assert.deepEqual(fields({ ...base, type: "LAND", transaction: "RENT", sellerType: null, bedrooms: null, bathrooms: null }), ["type"]);
});

test("sale requires developer/resale; rent forbids it", () => {
  assert.deepEqual(fields({ ...base, sellerType: null }), ["sellerType"]);
  assert.deepEqual(fields({ ...base, transaction: "RENT" }), ["sellerType"]);
});

test("residential needs bedrooms; land cannot have them", () => {
  assert.deepEqual(fields({ ...base, bedrooms: null }), ["bedrooms"]);
  assert.deepEqual(fields({ ...base, type: "LAND", bedrooms: 2 }), ["bedrooms"]);
  assert.deepEqual(fields({ ...base, type: "LAND", bedrooms: null, bathrooms: null }), []);
});

test("price and area must be positive", () => {
  assert.deepEqual(fields({ ...base, price: 0 }), ["price"]);
  assert.deepEqual(fields({ ...base, areaSqm: 0 }), ["areaSqm"]);
  assert.deepEqual(fields({ ...base, areaSqm: 120.5 }), ["areaSqm"]);
});
