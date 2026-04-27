const fs = require('fs');

let content = fs.readFileSync('src/components/NotasPage.tsx', 'utf8');

const regex = /\/\/\s*Funciones Deshacer\/Rehacer[\s\S]*?setNotas\(newNotas\);\s*\};\s*const redo = \(\) => \{[\s\S]*?setNotas\(newNotas\);\s*\};/g;

const newUndoRedo = `// Funciones Deshacer/Rehacer
  const updateInputsUI = (targetState: Map<string, string>) => {
    notasCualitativasRef.current = new Map(targetState);
    
    // Update all inputs visually without re-rendering everything
    inputsRef.current.forEach((inputEl, inputKey) => {
      const parts = inputKey.split('-');
      if (parts.length === 4) {
        const estId = parseInt(parts[1]);
        const critIdx = parseInt(parts[3]);
        const criterio = allCriterios[critIdx];
        if (criterio) {
          const key = \`\${estId}-\${criterio.id}\`;
          const val = targetState.get(key) || '';
          if (inputEl.value !== val) {
            inputEl.value = val;
          }
        }
      }
    });

    // Update row versions to recalculate totals
    setRowVersions(prev => {
      const next = new Map(prev);
      targetState.forEach((val, key) => {
        const estId = parseInt(key.split('-')[0]);
        next.set(estId, (next.get(estId) || 0) + 1);
      });
      return next;
    });
  };

  const undo = () => {
    const currentHistory = historyRef.current;
    if (currentHistory.length === 0) return;
    
    const previousState = currentHistory[currentHistory.length - 1];
    const newHistory = currentHistory.slice(0, -1);
    
    // Guardar estado actual en redoStack
    const currentRedoStack = [new Map(notasCualitativasRef.current), ...redoStackRef.current];
    redoStackRef.current = currentRedoStack;
    setRedoStack(currentRedoStack);
    
    // Actualizar historial
    historyRef.current = newHistory;
    setHistory(newHistory);
    
    // Actualizar estados
    isUndoRedoAction.current = true;
    updateInputsUI(previousState);
    
    // Sincronizar notas cuantitativas inmediatamente para asegurar actualización de UI
    const newNotas = estudiantes.map(est => {
      const studentNotas: Record<number, number> = {};
      indicadores.forEach(ind => {
        ind.criterios.forEach(crit => {
          const key = \`\${est.id}-\${crit.id}\`;
          const qualValue = previousState.get(key) || '';
          
          let numValue = 0;
          if (['AA', 'AS', 'AF', 'AI'].includes(qualValue)) {
            const percentage = notaMapping[qualValue as keyof typeof notaMapping];
            numValue = crit.puntajeMaximo * percentage;
          }
          studentNotas[crit.id] = numValue;
        });
      });
      return {
        estudianteId: est.id,
        estudianteNombre: est.nombre,
        notas: studentNotas
      };
    });
    setNotas(newNotas);
  };

  const redo = () => {
    const currentRedoStack = redoStackRef.current;
    if (currentRedoStack.length === 0) return;
    
    const nextState = currentRedoStack[0];
    const newRedoStack = currentRedoStack.slice(1);
    
    // Guardar estado actual en history
    const currentHistory = [...historyRef.current, new Map(notasCualitativasRef.current)];
    historyRef.current = currentHistory;
    setHistory(currentHistory);
    
    // Actualizar redoStack
    redoStackRef.current = newRedoStack;
    setRedoStack(newRedoStack);
    
    // Actualizar estados
    isUndoRedoAction.current = true;
    updateInputsUI(nextState);

    // Sincronizar notas cuantitativas inmediatamente para asegurar actualización de UI
    const newNotas = estudiantes.map(est => {
      const studentNotas: Record<number, number> = {};
      indicadores.forEach(ind => {
        ind.criterios.forEach(crit => {
          const key = \`\${est.id}-\${crit.id}\`;
          const qualValue = nextState.get(key) || '';
          
          let numValue = 0;
          if (['AA', 'AS', 'AF', 'AI'].includes(qualValue)) {
            const percentage = notaMapping[qualValue as keyof typeof notaMapping];
            numValue = crit.puntajeMaximo * percentage;
          }
          studentNotas[crit.id] = numValue;
        });
      });
      return {
        estudianteId: est.id,
        estudianteNombre: est.nombre,
        notas: studentNotas
      };
    });
    setNotas(newNotas);
  };`;

content = content.replace(regex, newUndoRedo);

fs.writeFileSync('src/components/NotasPage.tsx', content, 'utf8');
console.log("Patched undo/redo functions!");
