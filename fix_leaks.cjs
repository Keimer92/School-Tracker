const fs = require('fs');
const files = [
  'src/components/ReportesPage.tsx',
  'src/components/AsistenciaPage.tsx',
  'src/components/EstudiantesPage.tsx',
  'src/components/InformePage.tsx',
  'src/components/NotasPage.tsx'
];

files.forEach(file => {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    
    // Fix 1: ReportesPage pattern
    content = content.replace(/let unlistenGradeConfigs:[^]+?fetchInitialCatalogs\(\);/m, (match) => {
      if (match.includes('promises =')) return match;
      return match
        .replace(/let unlisten[A-Za-z]+: \(\(\) => void\) \| null = null;\n\s*/g, '')
        .replace(/listen\(([^)]+)\)\.then\(u => unlisten[A-Za-z]+ = u\);/g, 'listen()')
        .replace(/\/\/ REGISTRAR LISTENERS PRIMERO\n\s*/g, 'const promises = [\n    ')
        .replace(/,\n\s*\/\/ CARGAR/, '\n  ];\n\n  // CARGAR')
        .replace(/listen\(/g, '  listen(');
    });
    
    fs.writeFileSync(file, content);
  }
});
console.log('Done');
