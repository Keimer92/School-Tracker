import PocketBase from 'pocketbase';

const PB_URL = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
const ADMIN_EMAIL = 'admin@schooltracker.com';
const ADMIN_PASSWORD = 'Admin123456!';

const collections = [
  {
    name: 'ano_lectivo',
    type: 'base',
    schema: [
      { name: 'nombre', type: 'text', required: true, unique: true },
      { name: 'activo', type: 'bool' },
      { name: 'cualitativo', type: 'bool' },
      { name: 'user_id', type: 'text' },
    ],
  },
  {
    name: 'corte_evaluativo',
    type: 'base',
    schema: [
      { name: 'nombre', type: 'text', required: true, unique: true },
      { name: 'activo', type: 'bool' },
      { name: 'cualitativo', type: 'bool' },
      { name: 'user_id', type: 'text' },
    ],
  },
  {
    name: 'colegio',
    type: 'base',
    schema: [
      { name: 'nombre', type: 'text', required: true, unique: true },
      { name: 'activo', type: 'bool' },
      { name: 'cualitativo', type: 'bool' },
      { name: 'orden', type: 'number' },
      { name: 'user_id', type: 'text' },
    ],
  },
  {
    name: 'asignatura',
    type: 'base',
    schema: [
      { name: 'nombre', type: 'text', required: true, unique: true },
      { name: 'cualitativo', type: 'bool' },
      { name: 'user_id', type: 'text' },
    ],
  },
  {
    name: 'grado',
    type: 'base',
    schema: [
      { name: 'nombre', type: 'text', required: true, unique: true },
      { name: 'cualitativo', type: 'bool' },
      { name: 'user_id', type: 'text' },
    ],
  },
  {
    name: 'seccion',
    type: 'base',
    schema: [
      { name: 'nombre', type: 'text', required: true, unique: true },
      { name: 'cualitativo', type: 'bool' },
      { name: 'user_id', type: 'text' },
    ],
  },
  {
    name: 'estudiante',
    type: 'base',
    schema: [
      { name: 'nombre', type: 'text', required: true },
      { name: 'codigo', type: 'text', required: true, unique: true },
      { name: 'sexo', type: 'text' },
      { name: 'ano_lectivo_id', type: 'number' },
      { name: 'grado_id', type: 'number' },
      { name: 'seccion_id', type: 'number' },
      { name: 'colegio_id', type: 'number' },
      { name: 'telefono', type: 'text' },
      { name: 'direccion', type: 'text' },
      { name: 'email', type: 'text' },
      { name: 'foto', type: 'text' },
      { name: 'user_id', type: 'text' },
    ],
  },
  {
    name: 'grado_asignatura',
    type: 'base',
    schema: [
      { name: 'grado_id', type: 'number', required: true },
      { name: 'asignatura_id', type: 'number', required: true },
      { name: 'user_id', type: 'text' },
    ],
  },
  {
    name: 'colegio_asignatura',
    type: 'base',
    schema: [
      { name: 'colegio_id', type: 'number', required: true },
      { name: 'asignatura_id', type: 'number', required: true },
      { name: 'user_id', type: 'text' },
    ],
  },
  {
    name: 'indicador',
    type: 'base',
    schema: [
      { name: 'grado_id', type: 'number', required: true },
      { name: 'asignatura_id', type: 'number', required: true },
      { name: 'corte_evaluativo_id', type: 'number', required: true },
      { name: 'orden', type: 'number', required: true },
      { name: 'descripcion', type: 'text' },
      { name: 'activo', type: 'bool' },
      { name: 'user_id', type: 'text' },
    ],
  },
  {
    name: 'criterio',
    type: 'base',
    schema: [
      { name: 'indicador_id', type: 'number', required: true },
      { name: 'orden', type: 'number', required: true },
      { name: 'descripcion', type: 'text' },
      { name: 'puntaje_maximo', type: 'number', required: true },
      { name: 'user_id', type: 'text' },
    ],
  },
  {
    name: 'nota',
    type: 'base',
    schema: [
      { name: 'estudiante_id', type: 'number', required: true },
      { name: 'criterio_id', type: 'number', required: true },
      { name: 'valor', type: 'number', required: true },
      { name: 'corte_evaluativo_id', type: 'number', required: true },
      { name: 'asignatura_id', type: 'number', required: true },
      { name: 'user_id', type: 'text' },
    ],
  },
  {
    name: 'asistencia',
    type: 'base',
    schema: [
      { name: 'estudiante_id', type: 'number', required: true },
      { name: 'fecha', type: 'text', required: true },
      { name: 'estado', type: 'text', required: true },
      { name: 'observacion', type: 'text' },
      { name: 'user_id', type: 'text' },
    ],
  },
  {
    name: 'configuracion_calificacion',
    type: 'base',
    schema: [
      { name: 'nombre', type: 'text', required: true },
      { name: 'color', type: 'text', required: true },
      { name: 'minimo', type: 'number', required: true },
      { name: 'user_id', type: 'text' },
    ],
  },
  {
    name: 'colegio_dias_asistencia',
    type: 'base',
    schema: [
      { name: 'colegio_id', type: 'number', required: true },
      { name: 'lunes', type: 'bool' },
      { name: 'martes', type: 'bool' },
      { name: 'miercoles', type: 'bool' },
      { name: 'jueves', type: 'bool' },
      { name: 'viernes', type: 'bool' },
      { name: 'sabado', type: 'bool' },
      { name: 'domingo', type: 'bool' },
      { name: 'user_id', type: 'text' },
    ],
  },
];

async function main() {
  console.log(`Connecting to PocketBase at ${PB_URL}...`);
  const pb = new PocketBase(PB_URL);

  // Auth as superuser
  console.log('Authenticating as superuser...');
  try {
    await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
    console.log('Superuser authenticated!');
  } catch (e) {
    console.error('Failed to authenticate as superuser:', e.message);
    process.exit(1);
  }

  // Get existing collections
  const existingCollections = await pb.collections.getFullList();
  const existingNames = new Set(existingCollections.map((c) => c.name));
  console.log(`Found ${existingCollections.length} existing collections.`);

  // Create missing collections
  for (const col of collections) {
    if (existingNames.has(col.name)) {
      console.log(`  ⏭️  ${col.name} already exists`);
      continue;
    }

    try {
      await pb.collections.create(col);
      console.log(`  ✅ ${col.name} created`);
    } catch (e) {
      console.error(`  ❌ Error creating ${col.name}:`, e.message);
    }
  }

  console.log('\nSetup complete!');
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
