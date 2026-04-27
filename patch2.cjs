const fs = require('fs');

let content = fs.readFileSync('src/components/NotasPage.tsx', 'utf8');

// 1. Change `est: Estudiante` to `est: NotaEstudiante`
content = content.replace(/const renderRow = useCallback\(\(est: Estudiante, index: number\) => \{/g, 'const renderRow = useCallback((est: NotaEstudiante, index: number) => {');

// 2. Replace stickyBg with '#1e293b'
content = content.replace(/stickyBg/g, "'#1e293b'");

// 3. Add MemoRow definition at the top
if (!content.includes('const MemoRow')) {
  const memoRowDef = `
const MemoRow = memo(({ est, index, rowVersion, renderRow }: { est: NotaEstudiante, index: number, rowVersion: number, renderRow: (est: NotaEstudiante, index: number) => React.ReactNode }) => {
  return <>{renderRow(est, index)}</>;
});
`;
  content = content.replace(/export function NotasPage\(\) \{/, memoRowDef + '\nexport function NotasPage() {');
}

// 4. Add rowVersions state
if (!content.includes('rowVersions')) {
  content = content.replace(/const \[refreshTrigger, setRefreshTrigger\] = useState\(0\);/, `const [refreshTrigger, setRefreshTrigger] = useState(0);\n  const [rowVersions, setRowVersions] = useState<Map<number, number>>(new Map());`);
}

// 5. Add setRowVersions inside handleInputBlur
if (!content.includes('setRowVersions(')) {
  content = content.replace(/setRedoStack\(\[\]\);\s*\}\s*cellSnapshot\.current = null;/g, `setRedoStack([]);\n      setRowVersions(prev => {\n        const next = new Map(prev);\n        next.set(estudianteId, (next.get(estudianteId) || 0) + 1);\n        return next;\n      });\n    }\n    cellSnapshot.current = null;`);
}

// 6. Wrap calcularNotaCualitativaFinal
if (content.includes('const calcularNotaCualitativaFinal = (notasQual: string[]): string => {')) {
  content = content.replace(/const calcularNotaCualitativaFinal = \(notasQual: string\[\]\): string => \{([\s\S]*?)  \};/m, `const calcularNotaCualitativaFinal = useCallback((notasQual: string[]): string => {$1  }, []);`);
}

// 7. Wrap calcularTotalIndicador
if (content.includes('const calcularTotalIndicador = (estudianteNotas: Record<number, number>, indicador: Indicador): number => {')) {
  content = content.replace(/const calcularTotalIndicador = \(estudianteNotas: Record<number, number>, indicador: Indicador\): number => \{([\s\S]*?)  \};/m, `const calcularTotalIndicador = useCallback((estudianteNotas: Record<number, number>, indicador: Indicador): number => {$1  }, []);`);
}

// 8. Wrap calcularTotalFinal
if (content.includes('const calcularTotalFinal = (estudianteNotas: Record<number, number>): number => {')) {
  content = content.replace(/const calcularTotalFinal = \(estudianteNotas: Record<number, number>\): number => \{([\s\S]*?)  \};/m, `const calcularTotalFinal = useCallback((estudianteNotas: Record<number, number>): number => {$1  }, [isQualitative, indicadores, calcularTotalIndicador]);`);
}

fs.writeFileSync('src/components/NotasPage.tsx', content, 'utf8');
console.log("Fixed issues in NotasPage!");
