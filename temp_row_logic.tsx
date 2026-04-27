                  const estudianteNotas = notas.find(n => n.estudianteId === est.estudianteId) || { notas: {} };
                  
                  return (
                    <tr key={est.estudianteId} className="notas-row">
                      <td className="sticky-cell student-number" style={{ 
                        padding: '0.2rem', 
                        textAlign: 'center', 
                        position: 'sticky',
                        left: 0,
                        zIndex: 5,
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        fontSize: '0.65rem'
                      }}>{index + 1}</td>
                      <td className="sticky-cell student-name" style={{ 
                        padding: '0.3rem', 
                        position: 'sticky',
                        left: '35px',
                        zIndex: 5,
                        borderBottom: '1px solid rgba(255,255,255,0.05)'
                      }}>
                        <div style={{ 
                          fontWeight: 'bold', 
                          fontSize: '0.75rem', 
                          whiteSpace: 'nowrap', 
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis', 
                          maxWidth: '120px'
                        }}>{est.estudianteNombre}</div>
                      </td>
                      {(() => {
                        return indicadores.map(ind => (
                          <Fragment key={`row-${est.estudianteId}-ind-${ind.id}`}>
                            {ind.criterios.map(crit => {
                              const criterioIndex = criterioIndexMap.get(crit.id) ?? 0;
                              const inputKey = `row-${est.estudianteId}-col-${criterioIndex}`;
                              const key = `${est.estudianteId}-${crit.id}`;
                              const currentQualitativeValue = notasCualitativasRef.current.get(key) || '';
                              
                              return (
                                <td key={`${est.estudianteId}-${crit.id}`} style={{ padding: '0.15rem', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                  <input
                                    type="text"
                                    defaultValue={currentQualitativeValue}
                                    onChange={(e) => {
                                      const val = e.target.value.toUpperCase().slice(0, 2);
                                      notasCualitativasRef.current.set(key, val);
                                      e.target.value = val;
                                    }}
                                    onKeyDown={(e) => handleKeyDown(e, est.estudianteId, criterioIndex)}
                                    onFocus={(e) => {
                                      handleInputFocus();
                                      e.target.select();
                                    }}
                                    onBlur={(e) => {
                                      const val = e.target.value.toUpperCase();
                                      notasCualitativasRef.current.set(key, val);
                                      handleInputBlur(est.estudianteId, crit.id, val);
                                    }}
                                    ref={(el) => {
                                      if (el) inputsRef.current.set(inputKey, el);
                                      else inputsRef.current.delete(inputKey);
                                    }}
                                    style={{
                                      width: isQualitative ? '48px' : '32px',
                                      padding: '0.15rem',
                                      fontSize: isQualitative ? '0.85rem' : '0.75rem',
                                      textAlign: 'center',
                                      background: isQualitative ? 'rgba(139, 92, 246, 0.1)' : 'rgba(255,255,255,0.03)',
                                      border: `2px solid ${currentQualitativeValue ? getGradeColor(currentQualitativeValue, crit.puntajeMaximo) : (isQualitative ? 'rgba(139, 92, 246, 0.4)' : 'rgba(255,255,255,0.1)')}`,
                                      borderRadius: '4px',
                                      color: currentQualitativeValue ? getGradeColor(currentQualitativeValue, crit.puntajeMaximo) : (isQualitative ? '#a78bfa' : 'white'),
                                      textTransform: 'uppercase',
                                      fontWeight: currentQualitativeValue ? 'bold' : 'normal',
                                      outline: 'none'
                                    }}
                                    maxLength={2}
                                  />
                                </td>
                              );
                            })}
                            <td style={{ 
                              padding: '0.2rem', 
                              textAlign: 'center', 
                              fontWeight: 'bold', 
                              background: ind.activo ? 'rgba(100, 108, 255, 0.05)' : 'rgba(100, 116, 139, 0.08)',
                              borderBottom: '1px solid rgba(255,255,255,0.05)'
                            }}>
                              {(() => {
                                const totalIndicador = calcularTotalIndicador(estudianteNotas.notas, ind);
                                const totalIndicadorRedondeado = Math.round(totalIndicador);
                                
                                // Calcular el puntaje mÃ¡ximo real de este indicador
                                const maximoIndicador = ind.criterios.reduce((sum, c) => sum + (c.puntajeMaximo || 0), 0);
                                const totalEscalado = maximoIndicador > 0 ? (totalIndicador / maximoIndicador) * 100 : 0;
                                
                                const gradeConfig = getGradeFromScore(totalEscalado);
                                const qualitativeGrade = isQualitative 
                                  ? calcularNotaCualitativaFinal(ind.criterios.map(c => notasCualitativasRef.current.get(`${est.estudianteId}-${c.id}`) || ''))
                                  : (gradeConfig?.id || 'AI');
                                
                                const displayColor = ind.activo 
                                  ? (qualitativeGrade ? getGradeColor(qualitativeGrade) : '#94a3b8')
                                  : '#64748b';

                                return (
                                  <div style={{ color: displayColor, fontSize: '0.75rem', fontWeight: 'bold' }}>
                                    {isQualitative 
                                      ? qualitativeGrade 
                                      : `${totalIndicadorRedondeado}${qualitativeGrade ? ` (${qualitativeGrade})` : ''}`}
                                  </div>
                                );
                              })()}
                            </td>
                          </Fragment>
                        ));
                      })()}
                      <td style={{ 
                        padding: '0.2rem', 
                        textAlign: 'center', 
                        fontWeight: 'bold', 
                        background: stickyBg, // Forzamos fondo sÃ³lido para evitar transparencia
                        position: 'sticky',
                        right: 0,
                        zIndex: 5,
                        borderBottom: '1px solid rgba(34, 197, 94, 0.2)'
                      }}>
                        {(() => {
                          const rawTotalFinal = calcularTotalFinal(estudianteNotas.notas);
                          const totalFinal = Math.round(rawTotalFinal);
                          
                          // Calcular el puntaje mÃ¡ximo total de indicadores activos
                          const maximoTotal = indicadores
                            .filter(i => i.activo)
                            .reduce((sum, i) => sum + i.criterios.reduce((s, c) => s + (c.puntajeMaximo || 0), 0), 0);
                          
                          const totalEscaladoFinal = maximoTotal > 0 ? (rawTotalFinal / maximoTotal) * 100 : 0;
                          const gradeConfig = getGradeFromScore(totalEscaladoFinal);
                          const qualitativeFinal = isQualitative 
                            ? calcularNotaCualitativaFinal(indicadores.filter(i => i.activo).map(i => {
                                return calcularNotaCualitativaFinal(i.criterios.map(c => notasCualitativasRef.current.get(`${est.estudianteId}-${c.id}`) || ''));
                              }))
                            : (gradeConfig?.id || 'AI');
                          const displayColor = qualitativeFinal ? getGradeColor(qualitativeFinal) : '#94a3b8';

                          return (
                            <div style={{ 
                              color: displayColor, 
                              fontSize: '0.8rem', 
                              fontWeight: 'bold',
                              background: stickyBg, // Fondo sÃ³lido tambiÃ©n aquÃ­
                              padding: '0.2rem',
                              borderRadius: '4px'
                            }}>
                              {isQualitative 
                                ? qualitativeFinal 
                                : `${totalFinal}${qualitativeFinal ? ` (${qualitativeFinal})` : ''}`}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
