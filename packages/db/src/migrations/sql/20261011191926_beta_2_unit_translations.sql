CREATE TABLE unit_translation (
  unit_id uuid NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  locale text NOT NULL CHECK (locale <> 'en' AND locale ~ '^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|[0-9]{3}))?$'),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  symbol text NOT NULL CHECK (length(trim(symbol)) BETWEEN 1 AND 100),
  PRIMARY KEY (unit_id, locale)
);

INSERT INTO unit_translation (unit_id, locale, name, symbol)
SELECT unit.id, 'de', translation.name, translation.symbol
FROM unit
JOIN (VALUES
  ('unit.mass.gram', 'Gramm', 'g'),
  ('unit.mass.kilogram', 'Kilogramm', 'kg'),
  ('unit.mass.milligram', 'Milligramm', 'mg'),
  ('unit.mass.ounce', 'Unze', 'oz'),
  ('unit.mass.pound', 'Pfund', 'lb'),
  ('unit.volume.millilitre', 'Milliliter', 'ml'),
  ('unit.volume.litre', 'Liter', 'l'),
  ('unit.volume.teaspoon.metric', 'Teelöffel', 'TL'),
  ('unit.volume.tablespoon.metric', 'Esslöffel', 'EL'),
  ('unit.volume.cup.us', 'US-Cup', 'Cup'),
  ('unit.volume.fluid.ounce.us', 'US-Flüssigunze', 'fl oz'),
  ('unit.volume.pint.us', 'US-Pint', 'pt'),
  ('unit.volume.quart.us', 'US-Quart', 'qt'),
  ('unit.volume.gallon.us', 'US-Gallone', 'gal'),
  ('unit.count.piece', 'Stück', 'Stk.'),
  ('unit.count.dozen', 'Dutzend', 'Dtz.'),
  ('unit.temperature.kelvin', 'Kelvin', 'K'),
  ('unit.temperature.celsius', 'Grad Celsius', '°C'),
  ('unit.temperature.fahrenheit', 'Grad Fahrenheit', '°F')
) AS translation(localization_key, name, symbol)
  ON translation.localization_key = unit.localization_key;
