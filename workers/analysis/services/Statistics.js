let Statistics = {};

Statistics.getSummary = function (statistics) {
  return {
    components: statistics.components,
    licenses: statistics.licenses,
    warnings: statistics.legal.warnings + statistics.vulnerability.warnings + statistics.viability.warnings + statistics.integrity.warnings,
    violations: statistics.legal.violations + statistics.vulnerability.violations + statistics.viability.violations + statistics.integrity.violations
  };
};

Statistics.getState = function (statistics) {
  const sum = Statistics.getSummary(statistics);
  if(sum.violations){
    return 'violations';
  }
  return sum.warnings ? 'warnings' : 'ok';
};

export {
  Statistics
};
