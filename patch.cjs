const fs = require('fs');

let content = fs.readFileSync('src/components/NotasPage.tsx', 'utf8');
const trLogic = fs.readFileSync('temp_row_logic.tsx', 'utf8');

const renderRowCode = `
  const renderRow = useCallback((est: Estudiante, index: number) => {
${trLogic}
  }, [notas, indicadores, criterioIndexMap, isQualitative, getGradeColor, getGradeFromScore, calcularTotalIndicador, calcularNotaCualitativaFinal, calcularTotalFinal, handleKeyDown, handleInputFocus, handleInputBlur]);
`;

// Insert renderRow before return (
content = content.replace(/(  return \(\s*<div className="page-container">)/, renderRowCode + '\n$1');

// Replace tbody map
const oldMapRegex = /\{\s*filteredNotas\.map\(\(est, index\) => \{\s*const estudianteNotas = notas\.find.*?return \(\s*<tr key=\{est\.estudianteId\}.*?<\/tr>\s*\);\s*\}\)\s*\}/s;

const newMapCode = `{filteredNotas.map((est, index) => (
  <MemoRow key={est.estudianteId} est={est} index={index} rowVersion={rowVersions.get(est.estudianteId) || 0} renderRow={renderRow} />
))}`;

content = content.replace(oldMapRegex, newMapCode);

fs.writeFileSync('src/components/NotasPage.tsx', content, 'utf8');
console.log("Patched successfully!");
