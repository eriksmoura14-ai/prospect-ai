"use strict";

const FOOD_AMENITIES = ["restaurant", "fast_food", "cafe", "ice_cream", "food_court", "bar", "pub", "biergarten"];
const FOOD_SHOPS = ["bakery", "pastry", "confectionery", "ice_cream", "coffee", "deli"];
const FOOD_CRAFTS = ["bakery", "confectionery"];
const fold = value => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function isFoodPlace(tags) {
  return FOOD_AMENITIES.includes(tags.amenity) || FOOD_SHOPS.includes(tags.shop) || FOOD_CRAFTS.includes(tags.craft);
}

function matchesTags(tags, config) {
  if (config.tags.some(([key, value]) => tags[key] === value)) return true;
  if (!config.cuisines?.length || !isFoodPlace(tags) || typeof tags.cuisine !== "string") return false;
  const cuisines = tags.cuisine.split(";").map(fold);
  return config.cuisines.some(value => cuisines.includes(fold(value)));
}

function selectors(config, scope) {
  const result = config.tags.map(([key, value]) =>
    `nwr${scope}[${JSON.stringify(key)}=${JSON.stringify(value)}]["name"];`);
  if (config.cuisines?.length) {
    const cuisine = "(^|;)[[:space:]]*(" + config.cuisines.map(escape).join("|") + ")[[:space:]]*(;|$)";
    for (const [key, values] of [["amenity", FOOD_AMENITIES], ["shop", FOOD_SHOPS], ["craft", FOOD_CRAFTS]]) {
      result.push(`nwr${scope}[${JSON.stringify(key)}~${JSON.stringify("^(" + values.join("|") + ")$")}]["cuisine"~${JSON.stringify(cuisine)},i]["name"];`);
    }
  }
  return result;
}

module.exports = { matchesTags, selectors, isFoodPlace };
