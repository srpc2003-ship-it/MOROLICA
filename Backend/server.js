// API/index.js
// =======================
//  SERVIDOR ELECTORAL MOROLICA
// =======================

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ===== Pool DB =====
const pool = mysql.createPool({
  host: '127.0.0.1',
  user: 'root',
  password: '123456',
  database: 'elecciones_morolica',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4'
});

const q = async (sql, params = []) => {
  const [rows] = await pool.query(sql, params);
  return rows;
};

/* =========================
   ENDPOINTS BÁSICOS
========================= */

// Lugares
app.get('/api/lugares', async (_req, res) => {
  try {
    const rows = await q('SELECT * FROM lugar ORDER BY nombre_lugar');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error listando lugares' });
  }
});

// Partidos
app.get('/api/partidos', async (_req, res) => {
  try {
    const rows = await q('SELECT * FROM partido ORDER BY nombre_partido');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error listando partidos' });
  }
});

/* =========================
   URNAS
========================= */

// Crear urna
app.post('/api/urnas', async (req, res) => {
  try {
    const { id_lugar, nombre_urna } = req.body;
    if (!id_lugar || !nombre_urna) {
      return res.status(400).json({ error: 'Faltan campos' });
    }
    await q('INSERT INTO urna (id_lugar, nombre_urna) VALUES (?, ?)', [id_lugar, nombre_urna.trim()]);
    res.json({ message: 'Urna creada' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error creando urna' });
  }
});

// Editar nombre urna
app.put('/api/urnas/:id_urna', async (req, res) => {
  try {
    const { id_urna } = req.params;
    const { nombre_urna } = req.body;
    if (!nombre_urna) return res.status(400).json({ error: 'Falta nombre_urna' });
    await q('UPDATE urna SET nombre_urna = ? WHERE id_urna = ?', [nombre_urna.trim(), id_urna]);
    res.json({ message: 'Urna actualizada' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error actualizando urna' });
  }
});

// Eliminar urna (y sus votos)
app.delete('/api/urnas/:id_urna', async (req, res) => {
  try {
    const { id_urna } = req.params;
    await q('DELETE FROM urna_votos WHERE id_urna = ?', [id_urna]);
    await q('DELETE FROM urna WHERE id_urna = ?', [id_urna]);
    res.json({ message: 'Urna eliminada' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error eliminando urna' });
  }
});

/* =========================
   VOTOS POR URNA
========================= */

// Matriz por lugar
app.get('/api/urna_votos_matriz', async (req, res) => {
  try {
    const { id_lugar } = req.query;
    if (!id_lugar) return res.status(400).json({ error: 'Falta id_lugar' });

    const urnas = await q('SELECT id_urna, id_lugar, nombre_urna FROM urna WHERE id_lugar = ? ORDER BY nombre_urna', [id_lugar]);
    const partidos = await q('SELECT id_partido, nombre_partido FROM partido ORDER BY nombre_partido');
    const votos = await q(`
      SELECT uv.id_urna, uv.id_partido, uv.cantidad_votos
      FROM urna_votos uv
      JOIN urna u ON u.id_urna = uv.id_urna
      WHERE u.id_lugar = ?
    `, [id_lugar]);

    const matriz = {};
    const sum_por_partido = {};
    for (const p of partidos) sum_por_partido[p.id_partido] = 0;
    for (const r of votos) {
      const k = `${r.id_urna}_${r.id_partido}`;
      const n = Number(r.cantidad_votos || 0);
      matriz[k] = n;
      sum_por_partido[r.id_partido] += n;
    }

    res.json({ urnas, partidos, matriz, sum_por_partido });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error matriz lugar' });
  }
});

// Guardar voto individual
app.post('/api/urna_votos', async (req, res) => {
  try {
    const { id_urna, id_partido, cantidad_votos } = req.body;
    if (id_urna == null || id_partido == null || cantidad_votos == null) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }
    await q(`
      INSERT INTO urna_votos (id_urna, id_partido, cantidad_votos)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE cantidad_votos = VALUES(cantidad_votos)
    `, [id_urna, id_partido, cantidad_votos]);
    res.json({ message: 'Voto guardado' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error guardando voto' });
  }
});

// Guardado masivo (bulk)
app.post('/api/urna_votos_bulk', async (req, res) => {
  try {
    const { pares } = req.body; // [{id_urna,id_partido,cantidad_votos}]
    if (!Array.isArray(pares)) return res.status(400).json({ error: 'Formato inválido' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const p of pares) {
        await conn.query(`
          INSERT INTO urna_votos (id_urna, id_partido, cantidad_votos)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE cantidad_votos = VALUES(cantidad_votos)
        `, [p.id_urna, p.id_partido, p.cantidad_votos]);
      }
      await conn.commit();
      res.json({ message: 'Bulk OK' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en guardado masivo' });
  }
});

// Limpiar todos los votos
app.delete('/api/all_votos', async (_req, res) => {
  try {
    await q('DELETE FROM urna_votos');
    res.json({ message: 'Todo limpiado' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error limpiando votos' });
  }
});

// Matriz global (todas las urnas)
app.get('/api/urna_votos_matriz_all', async (_req, res) => {
  try {
    // 1) Cargar partidos primero (puede estar vacío y no debe romper)
    const partidos = await q(
      'SELECT id_partido, nombre_partido FROM partido ORDER BY nombre_partido'
    );

    // 2) Cargar urnas con su lugar (si no hay, devolvemos estructura vacía)
    const urnas = await q(`
      SELECT u.id_urna, u.id_lugar, u.nombre_urna, l.nombre_lugar
      FROM urna u
      LEFT JOIN lugar l ON l.id_lugar = u.id_lugar
      ORDER BY l.nombre_lugar, u.nombre_urna
    `);

    // Estructura base
    const matriz = {};

    // Si hay urnas, traemos los votos (si no hay, respondemos vacío sin romper)
    if (urnas.length > 0) {
      const ids = urnas.map(u => u.id_urna);
      // Evita IN() vacío
      const placeholders = ids.map(() => '?').join(',');
      const votos = await q(
        `SELECT id_urna, id_partido, cantidad_votos
         FROM urna_votos
         WHERE id_urna IN (${placeholders})`,
        ids
      );

      for (const v of votos) {
        matriz[`${v.id_urna}_${v.id_partido}`] = Number(v.cantidad_votos || 0);
      }
    }

    return res.json({ urnas, partidos, matriz });
  } catch (err) {
    console.error('GET /api/urna_votos_matriz_all', err);
    // En desarrollo ayuda ver el error:
    return res.status(500).json({ error: 'Error matriz global', detail: String(err.message || err) });
  }
});


/* =========================
   LÓGICA ELECTORAL (Art.195)
========================= */

function calcularCorporacion({ regidores = 6, planillas = [] }) {
  if (!Array.isArray(planillas) || planillas.length === 0) {
    return {
      totalVotos: 0, cociente: 0, ganador: null, regidoresTotales: regidores,
      detalle: [], repartoFinal: [], orden_asientos: []
    };
  }

  const totalVotos = planillas.reduce((s, p) => s + Number(p.total_votos || 0), 0);
  const divisor = regidores + 1; // Alcalde + regidores (excluye vice)
  const cociente = totalVotos / divisor;

  if (!isFinite(cociente) || cociente <= 0) {
    return {
      totalVotos, cociente: 0, ganador: null, regidoresTotales: regidores,
      detalle: planillas.map(p => ({ ...p, saldo: p.total_votos, regidores: 0 })),
      repartoFinal: planillas.map(p => ({ id_partido: p.id_partido, nombre_partido: p.nombre_partido, regidores: 0 })),
      orden_asientos: []
    };
  }

  const ganador = [...planillas].sort((a, b) => b.total_votos - a.total_votos)[0];

  const items = planillas.map(p => ({
    id_partido: p.id_partido,
    nombre_partido: p.nombre_partido,
    total_votos: Number(p.total_votos || 0),
    saldo: p.id_partido === ganador.id_partido
      ? Math.max(0, Number(p.total_votos || 0) - cociente)
      : Number(p.total_votos || 0),
    regidores: 0
  }));

  // Asignación secuencial por mayor saldo
  const orden_asientos = [];
  for (let k = 1; k <= regidores; k++) {
    items.sort((a, b) => {
      if (b.saldo !== a.saldo) return b.saldo - a.saldo;
      if (b.total_votos !== a.total_votos) return b.total_votos - a.total_votos;
      return a.nombre_partido.localeCompare(b.nombre_partido);
    });
    const elegido = items[0];
    orden_asientos.push({ k, id_partido: elegido.id_partido, nombre_partido: elegido.nombre_partido });
    elegido.regidores += 1;
    elegido.saldo = Math.max(0, elegido.saldo - cociente);
  }

  const detalle = [...items].sort((a, b) => b.total_votos - a.total_votos);
  const repartoFinal = detalle.map(d => ({
    id_partido: d.id_partido,
    nombre_partido: d.nombre_partido,
    regidores: d.regidores
  }));

  return {
    totalVotos,
    cociente,
    ganador: { id_partido: ganador.id_partido, nombre_partido: ganador.nombre_partido, votos: ganador.total_votos },
    regidoresTotales: regidores,
    detalle,
    repartoFinal,
    orden_asientos
  };
}

/* =========================
   RESULTADOS (desde urnas)
========================= */

app.get('/api/resultados', async (_req, res) => {
  try {
    // Sumar solo desde urna_votos
    const partidos = await q(`
      SELECT 
        p.id_partido,
        p.nombre_partido,
        IFNULL((
          SELECT SUM(uv.cantidad_votos)
          FROM urna_votos uv
          WHERE uv.id_partido = p.id_partido
        ), 0) AS total_votos
      FROM partido p
      ORDER BY total_votos DESC
    `);

    const resultado = calcularCorporacion({ regidores: 6, planillas: partidos });

    if (!resultado || !Number.isFinite(resultado.totalVotos) || resultado.totalVotos <= 0 || !resultado.ganador) {
      return res.json({
        total_votos_validos: Number(resultado?.totalVotos ?? 0),
        cociente_electoral: Number(resultado?.cociente ?? 0),
        partido_ganador: null,
        candidatos_ganadores: [],
        regidores_totales: 6,
        distribucion_regidores: (resultado?.repartoFinal ?? []).map(r => ({
          id_partido: r.id_partido, nombre_partido: r.nombre_partido, regidores: 0
        })),
        detalle_calculo: (resultado?.detalle ?? []).map(d => ({ ...d, regidores: 0 })),
        regidores_electos_por_partido: [],
        regidores_electos_flat: []
      });
    }

    // Alcalde/Vice del partido ganador
    let candidatosGanadores = [];
    try {
      candidatosGanadores = await q(
        `SELECT nombre, cargo
         FROM candidato
         WHERE id_partido = ?
           AND cargo IN ('Alcalde','Vicealcalde')
         ORDER BY FIELD(cargo,'Alcalde','Vicealcalde')`,
        [resultado.ganador.id_partido]
      );
    } catch {
      candidatosGanadores = [];
    }

    // Construir lista de regidores por orden de asientos + "alcalde perdedor"
    const partidosConCupos = (resultado.repartoFinal || []).filter(r => Number(r.regidores) > 0);

    let regidores_electos_por_partido = [];
    let regidores_electos_flat = [];

    if (partidosConCupos.length > 0) {
      const ids = partidosConCupos.map(r => r.id_partido);
      const placeholders = ids.map(() => '?').join(',');

      const candidatosReg = await q(
        `SELECT id_partido, nombre, COALESCE(orden_nomina, id_candidato) AS orden_planilla
         FROM candidato
         WHERE id_partido IN (${placeholders})
           AND (UPPER(cargo) LIKE 'REGIDOR%' OR UPPER(cargo) LIKE 'REGIDORA%' OR UPPER(cargo) LIKE 'REGIDOR(A)%')
         ORDER BY id_partido, orden_planilla ASC`,
        ids
      );

      const alcaldes = await q(
        `SELECT id_partido, nombre
         FROM candidato
         WHERE id_partido IN (${placeholders})
           AND (UPPER(cargo) LIKE 'ALCALDE%')
         ORDER BY id_partido`,
        ids
      );

      const mapaPlanilla = {};
      for (const c of candidatosReg) {
        if (!mapaPlanilla[c.id_partido]) mapaPlanilla[c.id_partido] = [];
        mapaPlanilla[c.id_partido].push(c.nombre);
      }
      const alcaldePorPartido = {};
      for (const a of alcaldes) if (!alcaldePorPartido[a.id_partido]) alcaldePorPartido[a.id_partido] = a.nombre;

      regidores_electos_por_partido = partidosConCupos.map(r => ({
        id_partido: r.id_partido,
        nombre_partido: r.nombre_partido,
        total_cupos: r.regidores,
        electos: []
      }));

      const esGanador = (id) => id === resultado.ganador.id_partido;
      const puntero = {};
      for (const id of ids) puntero[id] = 0;

      let nroGlobal = 1;
      for (const asiento of resultado.orden_asientos) {
        const idp = asiento.id_partido;
        const grupo = regidores_electos_por_partido.find(g => g.id_partido === idp);
        if (!grupo || grupo.electos.length >= grupo.total_cupos) continue;

        let nombre, fuente;
        const posicion = grupo.electos.length + 1;

        if (posicion === 1 && !esGanador(idp) && alcaldePorPartido[idp]) {
          nombre = alcaldePorPartido[idp];
          fuente = 'Alcalde perdedor';
        } else {
          const lista = mapaPlanilla[idp] || [];
          while (puntero[idp] < lista.length && lista[puntero[idp]] === alcaldePorPartido[idp]) {
            puntero[idp]++;
          }
          nombre = lista[puntero[idp]] || `Vacante ${posicion}`;
          fuente = lista[puntero[idp]] ? 'Planilla' : 'Vacante';
          if (lista[puntero[idp]]) puntero[idp]++;
        }

        grupo.electos.push({ posicion, nombre, cargo: 'Regidor(a)', fuente });
        regidores_electos_flat.push({
          nro: nroGlobal++,
          nombre,
          cargo: 'Regidor(a)',
          partido: grupo.nombre_partido,
          posicion_partido: posicion,
          fuente
        });

        if (regidores_electos_flat.length === resultado.regidoresTotales) break;
      }
    }

    res.json({
      total_votos_validos: resultado.totalVotos,
      cociente_electoral: Number(resultado.cociente.toFixed(6)),
      partido_ganador: resultado.ganador.nombre_partido,
      candidatos_ganadores: candidatosGanadores,
      regidores_totales: resultado.regidoresTotales,
      distribucion_regidores: resultado.repartoFinal,
      detalle_calculo: resultado.detalle,
      regidores_electos_por_partido,
      regidores_electos_flat
    });
  } catch (err) {
    console.error('GET /api/resultados', err);
    res.status(500).json({ error: 'Error calculando resultados electorales' });
  }
});

/* =========================
   INICIAR SERVIDOR
========================= */
const PORT = 3001;
app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));
