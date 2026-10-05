"use strict";

const define = (tags, terms) => ({ tags, terms });
const food = (tags, terms, cuisines = []) => ({ tags, terms, cuisines, food: true });

module.exports = {
  "Auto Detailing": define(
    [
      ["amenity", "car_wash"],
      ["shop", "car_wash"],
      ["craft", "car_detailing"]
    ],
    [
      "auto detailing",
      "detailing",
      "car wash",
      "vehicle cleaning",
      "mobile detailing",
      "car cleaning"
    ]
  ),

  Cleaning: define(
    [["craft", "cleaning"]],
    [
      "cleaning",
      "cleaner",
      "janitorial",
      "housekeeping",
      "house cleaning",
      "commercial cleaning"
    ]
  ),

  Landscaping: define(
    [
      ["craft", "gardener"],
      ["craft", "landscaper"]
    ],
    [
      "landscaping",
      "landscape",
      "gardener",
      "lawn care",
      "garden maintenance"
    ]
  ),

  Plumbing: define(
    [["craft", "plumber"]],
    [
      "plumbing",
      "plumber",
      "drain cleaning"
    ]
  ),

  HVAC: define(
    [
      ["craft", "hvac"],
      ["craft", "heating_engineer"]
    ],
    [
      "hvac",
      "heating",
      "air conditioning",
      "furnace",
      "ventilation",
      "heat pump"
    ]
  ),

  Roofing: define(
    [["craft", "roofer"]],
    [
      "roofing",
      "roofer",
      "roof repair"
    ]
  ),

  Painting: define(
    [["craft", "painter"]],
    [
      "painting",
      "painter",
      "decorating"
    ]
  ),

  Fencing: define(
    [["craft", "fence_builder"]],
    [
      "fencing",
      "fence contractor",
      "fence installation",
      "fence builder"
    ]
  ),

  "Pressure Washing": define(
    [["craft", "pressure_washing"]],
    [
      "pressure washing",
      "power washing",
      "exterior cleaning",
      "soft washing"
    ]
  ),

  Moving: define(
    [
      ["craft", "mover"],
      ["office", "moving_company"]
    ],
    [
      "moving company",
      "movers",
      "removals",
      "moving services"
    ]
  ),

  Handyman: define(
    [["craft", "handyman"]],
    [
      "handyman",
      "handyperson",
      "property maintenance",
      "home repair"
    ]
  ),

  Barber: define(
    [
      ["shop", "barber"],
      ["hairdresser", "barber"]
    ],
    [
      "barber",
      "barbershop",
      "barber shop",
      "mens haircut",
      "men's haircut"
    ]
  ),

  "Hair Salon": define(
    [["shop", "hairdresser"]],
    [
      "hair salon",
      "hairdresser",
      "hair studio",
      "coiffure"
    ]
  ),

  Electrician: define(
    [["craft", "electrician"]],
    [
      "electrician",
      "electrical contractor",
      "electrical services"
    ]
  ),

  Restaurantes: food(
    [["amenity", "restaurant"]],
    ["restaurante", "restaurant", "ristorante", "restauracion"]
  ),
  Hamburguerias: food(
    [], ["hamburgueria", "hamburguer", "hamburger", "burger", "burguer", "burger bar"],
    ["burger", "hamburger"]
  ),
  Sorveterias: food(
    [["amenity", "ice_cream"], ["shop", "ice_cream"]],
    ["sorveteria", "gelateria", "gelato", "ice cream", "heladeria", "heladería"],
    ["ice_cream", "gelato"]
  ),
  Pizzarias: food(
    [], ["pizzaria", "pizzeria", "pizza"], ["pizza"]
  ),
  Padarias: food(
    [["shop", "bakery"], ["craft", "bakery"]],
    ["padaria", "bakery", "boulangerie", "panaderia", "panadería", "bäckerei", "backerei"]
  ),
  Confeitarias: food(
    [["shop", "confectionery"], ["shop", "pastry"], ["craft", "confectionery"]],
    ["confeitaria", "doceria", "confectionery", "patisserie", "pâtisserie", "pasteleria", "pastelería", "cake shop"]
  ),
  Cafeterias: food(
    [["amenity", "cafe"]],
    ["cafeteria", "café", "cafe", "coffee shop", "coffee house"]
  ),
  Lanchonetes: food(
    [["amenity", "fast_food"], ["amenity", "food_court"]],
    ["lanchonete", "lanches", "snack bar", "fast food", "sandwich shop"]
  ),
  "Açaiterias": food(
    [], ["açaiteria", "acaiteria", "açaí", "acai"], ["acai", "açaí"]
  ),
  Churrascarias: food(
    [], ["churrascaria", "churrasco", "barbecue", "steakhouse", "steak house", "asador"],
    ["barbecue", "bbq", "steak_house"]
  )
};
