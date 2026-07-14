export const PCS_UNIT_TYPE = 'pcs';
export const BULK_UNIT_TYPE = 'bulk';

export function getProductUnitType(product) {
  return String(product?.unit_type || PCS_UNIT_TYPE).toLowerCase() === BULK_UNIT_TYPE
    ? BULK_UNIT_TYPE
    : PCS_UNIT_TYPE;
}

export function getProductBaseUnit(product) {
  return getProductUnitType(product) === PCS_UNIT_TYPE
    ? 'pcs'
    : String(product?.base_unit || 'kg').toLowerCase();
}

export function formatUnit(unit) {
  const normalized = String(unit || 'pcs').toLowerCase();
  return {
    pcs: 'pcs',
    kg: 'kg',
    g: 'g',
    l: 'L',
    ml: 'mL',
  }[normalized] || normalized;
}

export function formatQuantity(value, unit = 'pcs', unitType = PCS_UNIT_TYPE) {
  const numericValue = Number(value || 0);
  const maximumFractionDigits = unitType === BULK_UNIT_TYPE ? 3 : 0;
  const formattedValue = numericValue.toLocaleString('en-PH', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
  return `${formattedValue} ${formatUnit(unit)}`;
}

export function formatProductQuantity(product, quantity = product?.stock) {
  return formatQuantity(quantity, getProductBaseUnit(product), getProductUnitType(product));
}

export function getUnitMultiplier(baseUnit, saleUnit) {
  const normalizedBaseUnit = String(baseUnit || '').toLowerCase();
  const normalizedSaleUnit = String(saleUnit || '').toLowerCase();
  const conversionMap = {
    kg: { kg: 1, g: 0.001 },
    g: { g: 1, kg: 1000 },
    l: { l: 1, ml: 0.001 },
    ml: { ml: 1, l: 1000 },
  };
  return conversionMap[normalizedBaseUnit]?.[normalizedSaleUnit] ?? 1;
}

export function getBulkSaleOptions(product) {
  const baseUnit = getProductBaseUnit(product);
  const isVolume = baseUnit === 'l' || baseUnit === 'ml';
  const smallUnit = isVolume ? 'ml' : 'g';
  const largeUnit = isVolume ? 'l' : 'kg';

  return [
    { quantity: 100, saleUnit: smallUnit, label: `100 ${formatUnit(smallUnit)}` },
    { quantity: 250, saleUnit: smallUnit, label: `250 ${formatUnit(smallUnit)}` },
    { quantity: 500, saleUnit: smallUnit, label: `500 ${formatUnit(smallUnit)}` },
    { quantity: 1, saleUnit: largeUnit, label: `1 ${formatUnit(largeUnit)}` },
  ];
}

export function getTransactionItemQuantity(item) {
  const product = item?.product;
  const unitType = getProductUnitType(product);
  const quantity = item?.sale_quantity ?? item?.quantity ?? 0;
  const unit = item?.sale_unit || getProductBaseUnit(product);
  return formatQuantity(quantity, unit, unitType);
}
