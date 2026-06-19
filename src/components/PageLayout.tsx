import React from 'react';

/**
 * PageLayout
 * ----------
 * Componente base para páginas que necesitan:
 *  - Una barra de filtros sticky en la parte superior
 *  - Un área de contenido interno con scroll propio
 *
 * Uso:
 *   <PageLayout filters={<MiFilterContainer />}>
 *     <div className="table-container" style={{ flex: 1, overflow: 'auto' }}>
 *       <table>...</table>
 *     </div>
 *   </PageLayout>
 *
 * El componente se encarga de toda la cadena de flex (height: 100% → flex: 1 → minHeight: 0)
 * necesaria para que position: sticky y overflow: auto funcionen correctamente.
 */

interface PageLayoutProps {
  /** Contenido de la barra de filtros sticky (normalmente un <FilterContainer>) */
  filters?: React.ReactNode;
  /** Contenido principal que tendrá scroll interno */
  children: React.ReactNode;
  /** Clases extra para el contenedor raíz */
  className?: string;
  /** Estilos extra para el contenedor raíz */
  style?: React.CSSProperties;
  /** Estilos extra para el área de contenido scrollable */
  contentStyle?: React.CSSProperties;
  /** Estilos extra para la barra de filtros */
  filtersStyle?: React.CSSProperties;
}

export function PageLayout({
  filters,
  children,
  className = '',
  style = {},
  contentStyle = {},
  filtersStyle = {},
}: PageLayoutProps) {
  return (
    <div
      className={`page-container ${className}`}
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {/* Barra de filtros: no crece, no se encoge, se queda en top */}
      {filters && (
        <div
          className="page-layout__filters"
          style={{
            flexShrink: 0,
            ...filtersStyle,
          }}
        >
          {filters}
        </div>
      )}

      {/* Área de contenido: ocupa todo el espacio restante y permite scroll interno */}
      <div
        className="page-layout__content"
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          ...contentStyle,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * ScrollableTable
 * ---------------
 * Contenedor scrollable para tablas. Va siempre dentro de <PageLayout>.
 * Tiene overflow: auto propio, lo que permite que los thead sticky funcionen.
 *
 * Uso:
 *   <PageLayout filters={...}>
 *     <ScrollableTable>
 *       <table>...</table>
 *     </ScrollableTable>
 *   </PageLayout>
 */

interface ScrollableTableProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function ScrollableTable({
  children,
  className = '',
  style = {},
}: ScrollableTableProps) {
  return (
    <div
      className={`scroll-table-wrapper ${className}`}
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        width: '100%',
        WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
        ...style,
      }}
    >
      {children}
    </div>
  );
}
