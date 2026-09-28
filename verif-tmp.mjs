var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// C:/Users/Admin/AppData/Local/Temp/opencode/verif-fechas.ts
import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
var require_verif_fechas = __commonJS({
  "C:/Users/Admin/AppData/Local/Temp/opencode/verif-fechas.ts"() {
    var ruta = process.argv[2];
    var buf = readFileSync(ruta);
    var texto = "";
    var i = 0;
    while (true) {
      const ini = buf.indexOf("stream", i);
      if (ini === -1) break;
      let iniDatos = ini + 6;
      if (buf[iniDatos] === 13) iniDatos++;
      if (buf[iniDatos] === 10) iniDatos++;
      const fin = buf.indexOf("endstream", iniDatos);
      if (fin === -1) break;
      const bruto = buf.subarray(iniDatos, fin);
      try {
        texto += inflateSync(bruto).toString("latin1") + "\n";
      } catch {
        texto += bruto.toString("latin1") + "\n";
      }
      i = fin + 9;
    }
    var fechas = texto.match(/\(\d{2}\/\d{2}\)/g) || [];
    var partidos = texto.match(/\(\d{2}\)\s*Tj/g) || [];
    console.log(`Fechas como token \xFAnico "dd/mm": ${fechas.length}`);
    console.log(`Fragmentos "dd" sueltos (fecha partida): ${partidos.length}`);
    var muestra = [...new Set(fechas)].slice(0, 6);
    console.log(`Muestra: ${muestra.join(" ")}`);
    console.log(partidos.length === 0 ? "OK: ninguna fecha dividida en dos lineas" : "MAL: hay fechas partidas");
  }
});
export default require_verif_fechas();
