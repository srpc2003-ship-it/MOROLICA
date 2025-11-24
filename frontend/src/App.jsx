// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import "./App.css";

/* ===== URL base de API ===== */
const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

/* ===== Banderas (import Vite) ===== */
import dcPng from "./banderas/dc.png";
import liberalPng from "./banderas/liberal.png";
import librePng from "./banderas/libre.png";
import nacionalPng from "./banderas/nacional.png";
import pinuPng from "./banderas/pinu.png";

const BANDERAS = {
  DC: dcPng,
  LIBERAL: liberalPng,
  LIBRE: librePng,
  NACIONAL: nacionalPng,
  PINU: pinuPng,
};
const U = (s = "") => s.trim().toUpperCase();
const flagSrc = (nombrePartido, bandera_url) =>
  bandera_url || BANDERAS[U(nombrePartido)] || "";

/* ===== Debounce simple ===== */
function useDebouncedCallback(cb, delay = 600) {
  const t = useRef();
  return (...args) => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => cb(...args), delay);
  };
}

export default function App() {
  const [lugares, setLugares] = useState([]);
  const [partidos, setPartidos] = useState([]);
  const [resultados, setResultados] = useState(null);
  const [loadingBase, setLoadingBase] = useState(true);
  const [working, setWorking] = useState(false);

  // Tabs: tablero | reporte-general | reporte-urnas | reporte-urnas-all
  const [tab, setTab] = useState("tablero");

  // Totales por lugar/partido (desde urnas)
  const [totalesPorLugarPartido, setTotalesPorLugarPartido] = useState({});

  // Modal de URNAS por lugar
  const [urnaOpen, setUrnaOpen] = useState(false);
  const [urnaLugar, setUrnaLugar] = useState(null);
  const [urnas, setUrnas] = useState([]);
  const [urnaVotos, setUrnaVotos] = useState({});
  const [nuevaUrna, setNuevaUrna] = useState("");
  const [savingUrna, setSavingUrna] = useState(false);

  // Reporte de urnas por lugar
  const [reportLugarId, setReportLugarId] = useState("");
  const [repUrnas, setRepUrnas] = useState(null); // {urnas, partidos, matriz}

  // Reporte/Admin: todas las urnas
  const [repAll, setRepAll] = useState(null); // {urnas:[...], partidos, matriz}
  const [savingAll, setSavingAll] = useState(false);

  // Autosave por lotes
  const pendingBulk = useRef([]); // {id_urna, id_partido, cantidad_votos}
  const doBulkSave = async () => {
    if (pendingBulk.current.length === 0) return;
    let bulk;
    try {
      setSavingUrna(true);
      bulk = [...pendingBulk.current];
      pendingBulk.current = [];
      await axios.post(`${API}/api/urna_votos_bulk`, { pares: bulk });
    } catch (e) {
      console.error("Error bulk:", e);
      // si falla, reinsertamos para no perder cambios
      pendingBulk.current = [...bulk, ...pendingBulk.current];
    } finally {
      setSavingUrna(false);
    }
  };
  const debouncedBulk = useDebouncedCallback(doBulkSave, 700);

  /* ===== Cargar lugares/partidos ===== */
  useEffect(() => {
    (async () => {
      try {
        setLoadingBase(true);
        const [resL, resP] = await Promise.all([
          axios.get(`${API}/api/lugares`),
          axios.get(`${API}/api/partidos`),
        ]);
        setLugares(resL.data || []);
        setPartidos(resP.data || []);
      } catch (e) {
        console.error(e);
        alert("No se pudo cargar la base (lugares/partidos). Verifica la API.");
      } finally {
        setLoadingBase(false);
      }
    })();
  }, []);

  /* ===== Helpers de sumas ===== */
  const totalLugar = (id_lugar) => {
    let s = 0;
    for (const p of partidos)
      s += Number(totalesPorLugarPartido[`${id_lugar}_${p.id_partido}`] || 0);
    return s;
  };
  const totalPartidoGlobal = (id_partido) => {
    let s = 0;
    for (const l of lugares)
      s += Number(totalesPorLugarPartido[`${l.id_lugar}_${id_partido}`] || 0);
    return s;
  };
  const sumaTotalGlobal = useMemo(() => {
    let s = 0;
    for (const l of lugares) s += totalLugar(l.id_lugar);
    return s;
  }, [totalesPorLugarPartido, lugares, partidos]);

  /* ===== Modal URNAS por lugar ===== */
  const abrirUrnas = async (lugar) => {
    setUrnaLugar(lugar);
    setUrnaVotos({});
    setNuevaUrna("");
    try {
      const r = await axios.get(`${API}/api/urna_votos_matriz`, {
        params: { id_lugar: lugar.id_lugar },
      });
      const { urnas: u, matriz, sum_por_partido } =
        r.data || { urnas: [], matriz: {}, sum_por_partido: {} };
      setUrnas(u);
      setUrnaVotos(matriz || {});
      setTotalesPorLugarPartido((prev) => {
        const copy = { ...prev };
        for (const p of partidos)
          copy[`${lugar.id_lugar}_${p.id_partido}`] = Number(
            sum_por_partido?.[p.id_partido] || 0
          );
        return copy;
      });
    } catch (e) {
      console.error(e);
      setUrnas([]);
    }
    setUrnaOpen(true);
  };

  const cerrarUrnas = () => {
    setUrnaOpen(false);
    setUrnaLugar(null);
    setUrnas([]);
    setUrnaVotos({});
    setNuevaUrna("");
  };

  const recargarMatrizLugar = async (id_lugar) => {
    const r = await axios.get(`${API}/api/urna_votos_matriz`, {
      params: { id_lugar },
    });
    const { urnas: u, matriz, sum_por_partido } =
      r.data || { urnas: [], matriz: {}, sum_por_partido: {} };
    setUrnas(u);
    setUrnaVotos(matriz || {});
    setTotalesPorLugarPartido((prev) => {
      const copy = { ...prev };
      for (const p of partidos)
        copy[`${id_lugar}_${p.id_partido}`] = Number(
          sum_por_partido?.[p.id_partido] || 0
        );
      return copy;
    });
  };

  const crearUrna = async () => {
    if (!urnaLugar || !nuevaUrna.trim()) return;
    try {
      await axios.post(`${API}/api/urnas`, {
        id_lugar: urnaLugar.id_lugar,
        nombre_urna: nuevaUrna.trim(),
      });
      setNuevaUrna("");
      await recargarMatrizLugar(urnaLugar.id_lugar);
    } catch (e) {
      console.error(e);
      alert("No se pudo crear la urna (¿duplicado en ese lugar?).");
    }
  };

  const editarUrnaNombre = async (u) => {
    const nuevo = prompt("Nuevo nombre de la urna:", u.nombre_urna);
    if (!nuevo || !nuevo.trim()) return;
    try {
      await axios.put(`${API}/api/urnas/${u.id_urna}`, {
        nombre_urna: nuevo.trim(),
      });
      await recargarMatrizLugar(u.id_lugar);
    } catch (e) {
      console.error(e);
      alert("No se pudo actualizar el nombre (¿duplicado?).");
    }
  };

  const eliminarUrna = async (u) => {
    if (!window.confirm(`Eliminar "${u.nombre_urna}" y sus votos?`)) return;
    try {
      await axios.delete(`${API}/api/urnas/${u.id_urna}`);
      await recargarMatrizLugar(u.id_lugar);
    } catch (e) {
      console.error(e);
      alert("No se pudo eliminar la urna.");
    }
  };

  const setUV = (id_urna, id_partido, val) => {
    const n = Number(val);
    setUrnaVotos((prev) => ({
      ...prev,
      [`${id_urna}_${id_partido}`]: Number.isFinite(n) && n >= 0 ? n : 0,
    }));

    // encolar para bulk
    const cantidad_votos = Number.isFinite(n) && n >= 0 ? n : 0;
    const idx = pendingBulk.current.findIndex(
      (it) => it.id_urna === id_urna && it.id_partido === id_partido
    );
    if (idx >= 0) pendingBulk.current[idx].cantidad_votos = cantidad_votos;
    else pendingBulk.current.push({ id_urna, id_partido, cantidad_votos });
    debouncedBulk();
  };

  const guardarUrnasVotos = async () => {
    await doBulkSave(); // flush
    await recargarMatrizLugar(urnaLugar.id_lugar);
    cerrarUrnas();
  };

  /* ===== Limpiar todo ===== */
  const limpiarTodo = async () => {
    if (
      !window.confirm(
        "⚠️ Esto eliminará TODOS los votos (urna_votos). ¿Continuar?"
      )
    )
      return;
    try {
      setWorking(true);
      await axios.delete(`${API}/api/all_votos`);
      setUrnas([]);
      setUrnaVotos({});
      setTotalesPorLugarPartido({});
      setResultados(null);
      setRepUrnas(null);
      setRepAll(null);
      const r = await axios.get(`${API}/api/resultados`);
      setResultados(r.data);
    } catch (e) {
      console.error(e);
      alert("No se pudo limpiar todo.");
    } finally {
      setWorking(false);
    }
  };

  /* ===== Calcular resultados (desde BD urnas) ===== */
  const calcularResultados = async () => {
    try {
      setWorking(true);
      const res = await axios.get(`${API}/api/resultados`);
      setResultados(res.data || null);
    } catch (e) {
      console.error(e);
      alert("Error calculando resultados.");
    } finally {
      setWorking(false);
    }
  };

  /* ===== Reporte de URNAS por lugar ===== */
  const cargarReporteUrnas = async () => {
    if (!reportLugarId) {
      alert("Selecciona un lugar.");
      return;
    }
    try {
      const r = await axios.get(`${API}/api/urna_votos_matriz`, {
        params: { id_lugar: reportLugarId },
      });
      setRepUrnas(r.data || null);
      setTab("reporte-urnas");
    } catch (e) {
      console.error(e);
      alert("No se pudo cargar el reporte de urnas.");
    }
  };

  const rptUrnaTotalPorPartido = (id_partido) => {
    if (!repUrnas?.urnas) return 0;
    return repUrnas.urnas.reduce((acc, u) => {
      const n = Number(repUrnas.matriz?.[`${u.id_urna}_${id_partido}`] || 0);
      return acc + n;
    }, 0);
  };
  const rptUrnaTotalPorUrna = (id_urna) => {
    if (!repUrnas?.partidos) return 0;
    return repUrnas.partidos.reduce((acc, p) => {
      const n = Number(repUrnas.matriz?.[`${id_urna}_${p.id_partido}`] || 0);
      return acc + n;
    }, 0);
  };
  const rptUrnaTotalLugar = () => {
    if (!repUrnas?.urnas || !repUrnas?.partidos) return 0;
    return repUrnas.urnas.reduce(
      (acc, u) => acc + rptUrnaTotalPorUrna(u.id_urna),
      0
    );
  };

  /* ===== Reporte/Admin - TODAS las urnas ===== */
  const cargarReporteUrnasAll = async () => {
    try {
      const r = await axios.get(`${API}/api/urna_votos_matriz_all`);
      setRepAll(r.data || null);
      setTab("reporte-urnas-all");
    } catch (e) {
      console.error(e);
      alert("No se pudo cargar el reporte global de urnas.");
    }
  };

  const allTotalPorPartido = (id_partido) => {
    if (!repAll?.urnas) return 0;
    return repAll.urnas.reduce((acc, u) => {
      const n = Number(repAll.matriz?.[`${u.id_urna}_${id_partido}`] || 0);
      return acc + n;
    }, 0);
  };
  const allTotalPorUrna = (id_urna) => {
    if (!repAll?.partidos) return 0;
    return repAll.partidos.reduce((acc, p) => {
      const n = Number(repAll.matriz?.[`${id_urna}_${p.id_partido}`] || 0);
      return acc + n;
    }, 0);
  };
  const allTotalGlobal = () => {
    if (!repAll?.urnas) return 0;
    return repAll.urnas.reduce((acc, u) => acc + allTotalPorUrna(u.id_urna), 0);
  };

  const allSetUV = (id_urna, id_partido, val) => {
    const n = Number(val);
    setRepAll((prev) => {
      if (!prev) return prev;
      const matriz = { ...(prev.matriz || {}) };
      matriz[`${id_urna}_${id_partido}`] = Number.isFinite(n) && n >= 0 ? n : 0;
      return { ...prev, matriz };
    });

    const cantidad_votos = Number.isFinite(n) && n >= 0 ? n : 0;
    const idx = pendingBulk.current.findIndex(
      (it) => it.id_urna === id_urna && it.id_partido === id_partido
    );
    if (idx >= 0) pendingBulk.current[idx].cantidad_votos = cantidad_votos;
    else pendingBulk.current.push({ id_urna, id_partido, cantidad_votos });
    debouncedBulk();
  };

  const allGuardarAhora = async () => {
    await doBulkSave();
    await cargarReporteUrnasAll();
  };

  const allRenombrarUrna = async (u) => {
    const nuevo = prompt("Nuevo nombre de urna:", u.nombre_urna);
    if (!nuevo || !nuevo.trim()) return;
    try {
      await axios.put(`${API}/api/urnas/${u.id_urna}`, {
        nombre_urna: nuevo.trim(),
      });
      await cargarReporteUrnasAll();
    } catch (e) {
      console.error(e);
      alert("No se pudo renombrar.");
    }
  };

  const allEliminarUrna = async (u) => {
    if (!window.confirm(`Eliminar "${u.nombre_urna}" y sus votos?`)) return;
    try {
      await axios.delete(`${API}/api/urnas/${u.id_urna}`);
      await cargarReporteUrnasAll();
    } catch (e) {
      console.error(e);
      alert("No se pudo eliminar.");
    }
  };

  /* ===== Render ===== */
  return (
    <div className="wrap">
      {/* Header */}
      <header className="header no-print">
        <div className="h-left">
          <div className="logo">🗳️</div>
          <div className="titles">
            <h1>Elecciones Morolica 2025</h1>
            <p>Captura por urnas • Resultados • Reportes</p>
          </div>
        </div>
        <div className="h-right">
          <button
            className={`tab-btn ${tab === "tablero" ? "active" : ""}`}
            onClick={() => setTab("tablero")}
          >
            Tablero
          </button>
          <button
            className={`tab-btn ${
              tab === "reporte-general" ? "active" : ""
            }`}
            onClick={() => setTab("reporte-general")}
          >
            Reporte General
          </button>

          <div className="split">
            <select
              className="select"
              value={reportLugarId}
              onChange={(e) => setReportLugarId(e.target.value)}
            >
              <option value="">— Lugar para reporte de urnas —</option>
              {lugares.map((l) => (
                <option key={l.id_lugar} value={l.id_lugar}>
                  {l.nombre_lugar}
                </option>
              ))}
            </select>
            <button
              className={`tab-btn ${
                tab === "reporte-urnas" ? "active" : ""
              }`}
              onClick={cargarReporteUrnas}
            >
              Reporte de Urnas
            </button>
          </div>

          <button
            className={`tab-btn ${
              tab === "reporte-urnas-all" ? "active" : ""
            }`}
            onClick={cargarReporteUrnasAll}
          >
            Urnas (todas) / Admin
          </button>

          <button className="btn" onClick={() => window.print()}>
            Imprimir
          </button>
          <button className="btn warn" onClick={limpiarTodo} disabled={working}>
            Limpiar Todo
          </button>
          <button
            className="btn primary"
            onClick={calcularResultados}
            disabled={working || loadingBase}
          >
            {working ? "Procesando..." : "Calcular Resultados"}
          </button>
        </div>
      </header>

      {/* ===== Tablero ===== */}
      {tab === "tablero" && (
        <>
          {/* KPIs */}
          <section className="kpi-strip">
            <div className="kpi-card">
              <div className="kpi-label">Total de votos (global)</div>
              <div className="kpi-value">{sumaTotalGlobal}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Cociente electoral (÷7)</div>
              <div className="kpi-value">
                {typeof resultados?.cociente_electoral === "number"
                  ? resultados.cociente_electoral.toFixed(2)
                  : resultados?.cociente_electoral ?? 0}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Partido ganador</div>
              <div className="kpi-value blue">
                {resultados?.partido_ganador || "—"}
              </div>
            </div>
          </section>

          {/* Totales grandes por partido */}
          <section className="party-totals">
            {partidos.map((p) => {
              const src = flagSrc(p.nombre_partido, p.bandera_url);
              return (
                <div className="party-box" key={p.id_partido}>
                  <div className="party-name">
                    {src ? <img alt="" src={src} className="flag" /> : null}
                    {p.nombre_partido}
                  </div>
                  <div className="big">{totalPartidoGlobal(p.id_partido)}</div>
                </div>
              );
            })}
          </section>

          {/* Tarjetas por lugar */}
          <section className="places-grid">
            {loadingBase ? (
              <div className="skeleton">Cargando…</div>
            ) : (
              lugares.map((l) => (
                <div className="place-card" key={l.id_lugar}>
                  <div className="place-head">
                    <h3>{l.nombre_lugar}</h3>
                    <button className="chip no-print" onClick={() => abrirUrnas(l)}>
                      Urnas
                    </button>
                  </div>
                  <div className="place-body">
                    {partidos.map((p) => {
                      const src = flagSrc(p.nombre_partido, p.bandera_url);
                      return (
                        <div className="row" key={p.id_partido}>
                          <span className="label">
                            {src ? <img alt="" src={src} className="flag sm" /> : null}
                            {p.nombre_partido}
                          </span>
                          <span className="value">
                            {Number(
                              totalesPorLugarPartido[`${l.id_lugar}_${p.id_partido}`] || 0
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="place-foot">
                    <span>Total del lugar</span>
                    <strong>{totalLugar(l.id_lugar)}</strong>
                  </div>
                </div>
              ))
            )}
          </section>

          {/* Resultados (alcaldía + regidores) */}
          <section className="results-two">
            {Array.isArray(resultados?.candidatos_ganadores) &&
              resultados.candidatos_ganadores.length > 0 && (
                <div className="card">
                  <h3>Alcaldía electa ({resultados.partido_ganador})</h3>
                  <ul className="cand-list">
                    {resultados.candidatos_ganadores.map((c, i) => (
                      <li key={i}>
                        <b className="muted">{c.cargo}</b> · {c.nombre}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {Array.isArray(resultados?.regidores_electos_flat) &&
              resultados.regidores_electos_flat.length > 0 && (
                <div className="card">
                  <h3>Regidores electos</h3>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Nombre</th>
                          <th>Partido</th>
                          <th>Pos. partido</th>
                          <th>Fuente</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultados.regidores_electos_flat.map((r, i) => (
                          <tr key={i}>
                            <td>{r.nro}</td>
                            <td>{r.nombre}</td>
                            <td>{r.partido}</td>
                            <td>{r.posicion_partido}</td>
                            <td>{r.fuente}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
          </section>
        </>
      )}

      {/* ===== Reporte general ===== */}
      {tab === "reporte-general" && (
        <div className="print-block">
          <div className="print-title">Reporte General de Votos por Lugar</div>

          <div className="party-totals print">
            {partidos.map((p) => {
              const src = flagSrc(p.nombre_partido, p.bandera_url);
              return (
                <div className="party-box" key={p.id_partido}>
                  <div className="party-name">
                    {src ? <img alt="" src={src} className="flag" /> : null}
                    {p.nombre_partido}
                  </div>
                  <div className="big">{totalPartidoGlobal(p.id_partido)}</div>
                </div>
              );
            })}
            <div className="party-box total">
              <div className="party-name">Total General</div>
              <div className="big">{sumaTotalGlobal}</div>
            </div>
          </div>

          <div className="report-grid">
            {lugares.map((l) => (
              <div className="report-card" key={l.id_lugar}>
                <div className="r-head">{l.nombre_lugar}</div>
                <div className="r-body">
                  {partidos.map((p) => {
                    const src = flagSrc(p.nombre_partido, p.bandera_url);
                    return (
                      <div className="r-row" key={p.id_partido}>
                        <div className="r-label">
                          {src ? <img alt="" src={src} className="flag sm" /> : null}
                          {p.nombre_partido}
                        </div>
                        <div className="r-value big">
                          {Number(
                            totalesPorLugarPartido[`${l.id_lugar}_${p.id_partido}`] || 0
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div className="r-total">
                    <span>Total del lugar</span>
                    <span className="big">{totalLugar(l.id_lugar)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="report-summary">
            <div>
              Votos válidos: <b>{resultados?.total_votos_validos ?? 0}</b>
            </div>
            <div>
              Cociente electoral (÷7):{" "}
              <b>
                {typeof resultados?.cociente_electoral === "number"
                  ? resultados.cociente_electoral.toFixed(2)
                  : resultados?.cociente_electoral ?? 0}
              </b>
            </div>
            <div>
              Partido ganador: <b>{resultados?.partido_ganador || "—"}</b>
            </div>
          </div>

          {Array.isArray(resultados?.candidatos_ganadores) &&
            resultados.candidatos_ganadores.length > 0 && (
              <div className="report-card">
                <div className="r-head">
                  Alcaldía electa ({resultados.partido_ganador})
                </div>
                <div className="r-body slim">
                  {resultados.candidatos_ganadores.map((c, i) => (
                    <div className="r-row" key={i}>
                      <div className="r-label">{c.cargo}</div>
                      <div className="r-value">{c.nombre}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {Array.isArray(resultados?.regidores_electos_flat) &&
            resultados.regidores_electos_flat.length > 0 && (
              <div className="report-card no-break">
                <div className="r-head">Regidores electos</div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Nombre</th>
                        <th>Partido</th>
                        <th>Pos. partido</th>
                        <th>Fuente</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultados.regidores_electos_flat.map((r, i) => (
                        <tr key={i}>
                          <td>{r.nro}</td>
                          <td>{r.nombre}</td>
                          <td>{r.partido}</td>
                          <td>{r.posicion_partido}</td>
                          <td>{r.fuente}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
        </div>
      )}

      {/* ===== Reporte URNAS (por lugar) ===== */}
      {tab === "reporte-urnas" && repUrnas && (
        <div className="print-block">
          <div className="print-title">
            Reporte de Urnas —{" "}
            {lugares.find((l) => String(l.id_lugar) === String(reportLugarId))
              ?.nombre_lugar || ""}
          </div>

          <div className="party-totals print">
            {partidos.map((p) => {
              const src = flagSrc(p.nombre_partido, p.bandera_url);
              return (
                <div className="party-box" key={p.id_partido}>
                  <div className="party-name">
                    {src ? <img alt="" src={src} className="flag" /> : null}
                    {p.nombre_partido}
                  </div>
                  <div className="big">{rptUrnaTotalPorPartido(p.id_partido)}</div>
                </div>
              );
            })}
            <div className="party-box total">
              <div className="party-name">Total del lugar</div>
              <div className="big">{rptUrnaTotalLugar()}</div>
            </div>
          </div>

          <div className="table-wrap no-break">
            <table className="table-urna">
              <thead>
                <tr>
                  <th>Urna</th>
                  {partidos.map((p) => (
                    <th key={p.id_partido} className="right">
                      {p.nombre_partido}
                    </th>
                  ))}
                  <th className="right">Total urna</th>
                </tr>
              </thead>
              <tbody>
                {repUrnas.urnas.map((u) => (
                  <tr key={u.id_urna}>
                    <td className="strong">{u.nombre_urna}</td>
                    {partidos.map((p) => {
                      const n = Number(
                        repUrnas.matriz?.[`${u.id_urna}_${p.id_partido}`] || 0
                      );
                      return (
                        <td key={p.id_partido} className="right">
                          <span className="big">{n}</span>
                        </td>
                      );
                    })}
                    <td className="right">
                      <span className="big">{rptUrnaTotalPorUrna(u.id_urna)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== Reporte/Admin — TODAS las urnas ===== */}
      {tab === "reporte-urnas-all" && repAll && (
        <div className="print-block">
          <div className="print-title">Urnas (todas) — Administración y Reporte</div>

          <div className="party-totals print">
            {repAll.partidos.map((p) => {
              const src = flagSrc(p.nombre_partido, p.bandera_url);
              return (
                <div className="party-box" key={p.id_partido}>
                  <div className="party-name">
                    {src ? <img alt="" src={src} className="flag" /> : null}
                    {p.nombre_partido}
                  </div>
                  <div className="big">{allTotalPorPartido(p.id_partido)}</div>
                </div>
              );
            })}
            <div className="party-box total">
              <div className="party-name">Total global</div>
              <div className="big">{allTotalGlobal()}</div>
            </div>
          </div>

          <div className="table-wrap no-break">
            <table className="table-urna">
              <thead>
                <tr>
                  <th style={{ minWidth: 220 }}>Lugar / Urna</th>
                  {repAll.partidos.map((p) => (
                    <th key={p.id_partido} className="right">
                      {p.nombre_partido}
                    </th>
                  ))}
                  <th className="right">Total urna</th>
                  <th className="no-print">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {repAll.urnas.map((u) => (
                  <tr key={u.id_urna}>
                    <td className="strong">
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {u.nombre_lugar}
                        </span>
                        <span>{u.nombre_urna}</span>
                      </div>
                    </td>
                    {repAll.partidos.map((p) => {
                      const val = Number(
                        repAll.matriz?.[`${u.id_urna}_${p.id_partido}`] || 0
                      );
                      return (
                        <td key={p.id_partido} className="right">
                          <input
                            type="number"
                            min="0"
                            inputMode="numeric"
                            className="vote-input small"
                            value={val}
                            onChange={(e) =>
                              allSetUV(u.id_urna, p.id_partido, e.target.value)
                            }
                          />
                        </td>
                      );
                    })}
                    <td className="right">
                      <b>{allTotalPorUrna(u.id_urna)}</b>
                    </td>
                    <td className="no-print">
                      <button className="link" onClick={() => allRenombrarUrna(u)}>
                        renombrar
                      </button>
                      <button
                        className="link danger"
                        onClick={() => allEliminarUrna(u)}
                      >
                        eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="toolbar" style={{ justifyContent: "flex-end" }}>
              <span className={`save-hint ${savingUrna || savingAll ? "saving" : ""}`}>
                {savingUrna || savingAll ? "Guardando…" : "Cambios guardados"}
              </span>
              <button className="btn" onClick={allGuardarAhora}>
                Guardar ahora
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de URNAS por lugar */}
      {urnaOpen && urnaLugar && (
        <div className="modal-overlay no-print" onClick={cerrarUrnas}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Urnas — {urnaLugar.nombre_lugar}</h3>
              <button className="close" onClick={cerrarUrnas}>
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="toolbar">
                <input
                  type="text"
                  placeholder="Nombre de la urna (U1, Mesa 3...)"
                  value={nuevaUrna}
                  onChange={(e) => setNuevaUrna(e.target.value)}
                />
                <button className="btn" onClick={crearUrna}>
                  Agregar urna
                </button>
                <span className={`save-hint ${savingUrna ? "saving" : ""}`}>
                  {savingUrna ? "Guardando…" : "Autoguardado activo"}
                </span>
              </div>

              {urnas.length === 0 ? (
                <div className="muted">Aún no hay urnas para este lugar.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ minWidth: 240 }}>Urna</th>
                        {partidos.map((p) => (
                          <th key={p.id_partido} className="right">
                            {p.nombre_partido}
                          </th>
                        ))}
                        <th className="right">Total urna</th>
                        <th className="no-print">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {urnas.map((u) => {
                        const totalU = partidos.reduce(
                          (acc, p) =>
                            acc +
                            Number(urnaVotos[`${u.id_urna}_${p.id_partido}`] || 0),
                          0
                        );
                        return (
                          <tr key={u.id_urna}>
                            <td className="strong">
                              <span>{u.nombre_urna}</span>
                              <button className="link" onClick={() => editarUrnaNombre(u)}>
                                renombrar
                              </button>
                            </td>
                            {partidos.map((p) => (
                              <td key={p.id_partido} className="right">
                                <input
                                  type="number"
                                  min="0"
                                  inputMode="numeric"
                                  className="vote-input small"
                                  value={urnaVotos[`${u.id_urna}_${p.id_partido}`] ?? ""}
                                  onChange={(e) =>
                                    setUV(u.id_urna, p.id_partido, e.target.value)
                                  }
                                />
                              </td>
                            ))}
                            <td className="right">
                              <b>{totalU}</b>
                            </td>
                            <td className="no-print">
                              <button
                                className="link danger"
                                onClick={() => eliminarUrna(u)}
                              >
                                eliminar
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="modal-foot">
              <button className="btn ghost" onClick={cerrarUrnas}>
                Cerrar
              </button>
              <button className="btn primary" onClick={guardarUrnasVotos}>
                Guardar y cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
