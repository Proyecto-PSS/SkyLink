'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import MonthSelector from '@/components/agenda/MonthSelector'
import DaySelector from '@/components/agenda/DaySelector'
import ShiftConfigCard from '@/components/agenda/ShiftConfigCard'
import CalendarView from '@/components/agenda/CalendarView'
import PublishModal from '@/components/agenda/PublishModal'
import {
  DiaSemana,
  DuracionTurno,
  DisponibilidadMedica,
  Turno,
  ResumenPublicacion,
} from '@/lib/types/agenda'
import {
  calcularTurnosPosibles,
  obtenerFechasDelMesParaDia,
  NOMBRES_DIAS,
  getMesActual,
  esMesPasado,
} from '@/lib/utils/agenda-utils'
import {
  ShiftDraft,
  saveDraft,
  loadDraft,
  clearDraft,
  checkConnectivity,
  compareShifts
} from '@/lib/utils/availability-draft'

export type SaveStatus = 
  | 'sin_cambios' 
  | 'guardando' 
  | 'guardado' 
  | 'cambios_locales' 
  | 'offline_borrador' 
  | 'recuperando' 
  | 'borrador_recuperado' 
  | 'error' 
  | 'publicado'

export default function AgendaMedicaPage() {
  const [tab, setTab] = useState<'disponibilidad' | 'agenda'>('disponibilidad')
  const [currentMonth, setCurrentMonth] = useState<string>(() => getMesActual())
  const [shifts, setShifts] = useState<ShiftDraft[]>([])

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('sin_cambios')
  const [isOffline, setIsOffline] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Datos del médico logueado
  const [medico, setMedico] = useState({
    id: '',
    nombre: '',
    especialidad: '',
    matricula: '',
  })

  // Modal de Publicación (US-04)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [resumenPublicacion, setResumenPublicacion] = useState<ResumenPublicacion | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  // Turnos disponibles de la agenda
  const [turnosPublicados, setTurnosPublicados] = useState<Turno[]>([])
  const [isLoadingTurnos, setIsLoadingTurnos] = useState(false)

  // Connectivity effect (US-19)
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false)
      setSaveStatus((prev) => (prev === 'offline_borrador' ? 'cambios_locales' : prev))
    }
    const handleOffline = () => {
      setIsOffline(true)
      setSaveStatus((prev) => {
        if (prev === 'cambios_locales' || prev === 'sin_cambios' || prev === 'guardado' || prev === 'borrador_recuperado') {
          return 'offline_borrador'
        }
        return prev
      })
    }
    
    setIsOffline(!checkConnectivity())
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Guardar en LocalStorage preventivamente si hay cambios (US-19)
  useEffect(() => {
    if (!medico.id || shifts.length === 0) return
    
    if (saveStatus === 'cambios_locales' || saveStatus === 'offline_borrador') {
      const success = saveDraft(medico.id, currentMonth, shifts)
      if (!success && isOffline) {
        setErrorMessage('Error al guardar el borrador en LocalStorage. Verifica que tengas espacio.')
      }
    }
  }, [shifts, currentMonth, medico.id, saveStatus, isOffline])

  // Cargar disponibilidades existentes al cambiar de mes
  const cargarDisponibilidades = useCallback(async (mes: string) => {
    try {
      setSaveStatus('recuperando')
      setErrorMessage(null)
      setShifts([])
      
      const res = await fetch(`/api/medicos/disponibilidad?mes=${mes}`)
      if (!res.ok) throw new Error('Error al consultar disponibilidades')
      const data = await res.json()

      let loadedMedicoId = medico.id
      if (data.medico) {
        loadedMedicoId = data.medico.id
        setMedico({
          id: data.medico.id,
          nombre: data.medico.nombre,
          especialidad: data.medico.especialidad.replace(' y Ortopedia', ''),
          matricula: data.medico.matricula,
        })
      }

      let remoteShifts: ShiftDraft[] = []
      if (data.disponibilidades && data.disponibilidades.length > 0) {
        remoteShifts = data.disponibilidades.map((d: DisponibilidadMedica) => ({
          id: d.id,
          diaSemana: d.dia_semana,
          horaDesde: d.hora_desde,
          horaHasta: d.hora_hasta,
          duracion: d.duracion_turno_minutos,
        }))
      }

      // Check draft (US-19)
      const draft = loadDraft(loadedMedicoId, mes)
      if (draft) {
        const isSame = compareShifts(remoteShifts, draft.shifts)
        if (isSame) {
          // If draft is exactly same as remote, no pending changes
          setShifts(remoteShifts)
          setSaveStatus(remoteShifts.length > 0 ? 'guardado' : 'sin_cambios')
          clearDraft(loadedMedicoId, mes)
        } else {
          // Has pending changes
          setShifts(draft.shifts)
          setSaveStatus(isOffline ? 'offline_borrador' : 'borrador_recuperado')
          setSuccessMessage('Se recuperó un borrador local con cambios pendientes de publicar.')
        }
      } else {
        setShifts(remoteShifts)
        setSaveStatus(remoteShifts.length > 0 ? 'guardado' : 'sin_cambios')
      }

    } catch (err: any) {
      console.error(err)
      setShifts([])
      setSaveStatus('error')
      if (isOffline) {
         setErrorMessage('No hay conexión a internet. Intenta nuevamente cuando te reconectes.')
      } else {
         setErrorMessage('Error al cargar disponibilidades del servidor.')
      }
    }
  }, [medico.id, isOffline])

  // Cargar turnos disponibles de la agenda
  const cargarTurnosAgenda = useCallback(async (mes: string) => {
    try {
      setIsLoadingTurnos(true)
      setTurnosPublicados([])
      const res = await fetch(`/api/medicos/agenda?mes=${mes}&vista=mensual`)
      if (!res.ok) throw new Error('Error al cargar agenda médica')
      const data = await res.json()
      setTurnosPublicados(data.turnos || [])
    } catch (err) {
      console.error(err)
      setTurnosPublicados([])
    } finally {
      setIsLoadingTurnos(false)
    }
  }, [])

  useEffect(() => {
    cargarDisponibilidades(currentMonth)
    cargarTurnosAgenda(currentMonth)
  }, [currentMonth, cargarDisponibilidades, cargarTurnosAgenda])

  // Cálculo en tiempo real del resumen mensual para la tarjeta de resumen (Wireframe US-03)
  const resumenEnVivo = useMemo(() => {
    let totalJornadas = 0
    let totalTurnos = 0
    const detallesDias: string[] = []

    for (const s of shifts) {
      const fechas = obtenerFechasDelMesParaDia(currentMonth, s.diaSemana)
      const turnosPorDia = calcularTurnosPosibles(s.horaDesde, s.horaHasta, s.duracion).total
      const subtotal = turnosPorDia * fechas.length

      totalJornadas += fechas.length
      totalTurnos += subtotal
      detallesDias.push(`${fechas.length} ${NOMBRES_DIAS[s.diaSemana]}`)
    }

    return {
      totalJornadas,
      totalTurnos,
      descripcionDias: detallesDias.join(' + '),
    }
  }, [shifts, currentMonth])

  // Toggle de día seleccionado
  const handleToggleDay = async (dia: DiaSemana) => {
    setErrorMessage(null)
    setSuccessMessage(null)

    const exists = shifts.some((s) => s.diaSemana === dia)
    if (exists) {
      await handleRemoveShift(dia)
    } else {
      if (shifts.length >= 2) {
        setErrorMessage('Solo puedes seleccionar hasta 2 días semanales.')
        return
      }
      setShifts([
        ...shifts,
        {
          diaSemana: dia,
          horaDesde: '08:00',
          horaHasta: '13:00',
          duracion: 30,
        },
      ])
      setSaveStatus(isOffline ? 'offline_borrador' : 'cambios_locales')
    }
  }

  // Modificar horario o duración de una franja
  const handleUpdateShift = (
    dia: DiaSemana,
    fields: { horaDesde?: string; horaHasta?: string; duracion?: DuracionTurno }
  ) => {
    setErrorMessage(null)
    setSuccessMessage(null)
    setShifts((prev) =>
      prev.map((s) => (s.diaSemana === dia ? { ...s, ...fields } : s))
    )
    setSaveStatus(isOffline ? 'offline_borrador' : 'cambios_locales')
  }

  // Eliminar franja
  const handleRemoveShift = async (dia: DiaSemana) => {
    setErrorMessage(null)
    const target = shifts.find((s) => s.diaSemana === dia)
    
    // Si la franja a eliminar ya estaba en el servidor, intentamos eliminarla
    if (target?.id && !isOffline) {
      try {
        const res = await fetch(`/api/medicos/disponibilidad/${target.id}`, { method: 'DELETE' })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || 'No se pudo eliminar la disponibilidad')
        }
        if (data.message) {
          setSuccessMessage(data.message)
        }
      } catch (err) {
        console.error('Error eliminando en servidor:', err)
        setErrorMessage(err instanceof Error ? err.message : 'No se pudo eliminar la disponibilidad')
        return
      }
    }
    
    const newShifts = shifts.filter((s) => s.diaSemana !== dia)
    setShifts(newShifts)
    setSaveStatus(isOffline ? 'offline_borrador' : 'cambios_locales')
    
    if (newShifts.length === 0) {
      clearDraft(medico.id, currentMonth)
    }
  }

  // Guardar disponibilidad y generar sus turnos disponibles en el servidor
  const handleGuardarBorrador = async () => {
    setErrorMessage(null)
    setSuccessMessage(null)
    
    if (isOffline) {
      setSaveStatus('offline_borrador')
      saveDraft(medico.id, currentMonth, shifts)
      setErrorMessage('Estás sin conexión. Los cambios se guardaron como borrador local. Podrás publicarlos cuando recuperes conectividad.')
      return
    }

    setSaveStatus('guardando')

    try {
      if (esMesPasado(currentMonth)) {
        throw new Error('No se puede configurar disponibilidad para meses anteriores al actual.')
      }

      if (shifts.length === 0) {
        throw new Error('Debes seleccionar al menos un día de atención.')
      }
      if (shifts.length > 2) {
        throw new Error('No puedes configurar más de 2 días a la semana.')
      }

      let finalMessage = 'Disponibilidad guardada correctamente en el servidor remoto.'

      for (const s of shifts) {
        const res = await fetch('/api/medicos/disponibilidad', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mes_vigencia: currentMonth,
            dia_semana: s.diaSemana,
            hora_desde: s.horaDesde,
            hora_hasta: s.horaHasta,
            duracion_turno_minutos: s.duracion,
          }),
        })

        const resData = await res.json()

        if (!res.ok) {
          throw new Error(resData.error || 'Error al guardar disponibilidad')
        }

        if (resData.turnos_cancelados && resData.turnos_cancelados > 0) {
          finalMessage = resData.message
        }
      }

      setSaveStatus('guardado')
      setSuccessMessage(finalMessage)
      
      // Cleanup local draft if it matches what we just sent
      clearDraft(medico.id, currentMonth)

      await cargarDisponibilidades(currentMonth)
      await cargarTurnosAgenda(currentMonth)
    } catch (err: any) {
      setSaveStatus('error')
      setErrorMessage(err.message || 'Error al guardar disponibilidad')
      throw err
    }
  }

  // Abrir modal de confirmación y publicación (US-04)
  const handleRevisarYPublicar = async () => {
    setErrorMessage(null)
    setPublishError(null)

    if (isOffline) {
      setErrorMessage('No tienes conexión. No es posible publicar la agenda en este momento.')
      return
    }

    try {
      if (shifts.length === 0) {
        throw new Error('Debes seleccionar al menos un día de atención.')
      }

      if (saveStatus === 'cambios_locales' || saveStatus === 'borrador_recuperado') {
        await handleGuardarBorrador()
      }

      const res = await fetch(`/api/medicos/disponibilidad/resumen?mes=${currentMonth}`)
      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || errData.message || 'Error al obtener resumen de publicación')
      }

      const data = await res.json()
      setResumenPublicacion(data)
      setIsModalOpen(true)
    } catch (err: any) {
      setErrorMessage(err.message || 'No se pudo generar el resumen de publicación')
    }
  }

  // Confirmar y publicar agenda mensual (US-04)
  const handleConfirmarPublicacion = async () => {
    if (isOffline) {
      setPublishError('Se ha perdido la conexión. No es posible confirmar la publicación.')
      return
    }

    setIsPublishing(true)
    setPublishError(null)

    try {
      const res = await fetch('/api/medicos/agenda/publicar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mes_vigencia: currentMonth }),
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || errData.message || 'Error al publicar agenda médica')
      }

      const data = await res.json()
      setIsModalOpen(false)
      setSaveStatus('publicado')
      setSuccessMessage(
        `¡Agenda publicada con éxito! Se abrieron ${data.total_turnos} turnos en ${data.total_jornadas} jornadas para reserva online de pacientes.`
      )

      clearDraft(medico.id, currentMonth)

      await cargarDisponibilidades(currentMonth)
      await cargarTurnosAgenda(currentMonth)
      setTab('agenda')
    } catch (err: any) {
      setPublishError(err.message || 'Error durante la publicación de agenda')
    } finally {
      setIsPublishing(false)
    }
  }

  const selectedDays: DiaSemana[] = shifts.map((s) => s.diaSemana)

  const renderStatusIndicator = () => {
    switch (saveStatus) {
      case 'sin_cambios':
        return (
          <>
            <span className="w-2 h-2 rounded-full bg-slate-400" aria-hidden="true" />
            <span aria-live="polite">Sin cambios</span>
          </>
        )
      case 'guardando':
        return (
          <>
            <svg className="w-3.5 h-3.5 animate-spin text-black" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span aria-live="polite">Guardando...</span>
          </>
        )
      case 'guardado':
        return (
          <>
            <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
            <span aria-live="polite">Guardado en servidor remoto</span>
          </>
        )
      case 'cambios_locales':
        return (
          <>
            <span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden="true" />
            <span aria-live="polite">Cambios pendientes de guardado remoto</span>
          </>
        )
      case 'offline_borrador':
        return (
          <>
            <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.168a3 3 0 01-2.828-2.829m0 0l-2.829-2.829m2.829 2.829L3 3" />
            </svg>
            <span aria-live="polite">Sin conexión - borrador preservado</span>
          </>
        )
      case 'recuperando':
        return (
          <>
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" aria-hidden="true" />
            <span aria-live="polite">Recuperando borrador...</span>
          </>
        )
      case 'borrador_recuperado':
        return (
          <>
            <span className="w-2 h-2 rounded-full bg-indigo-500" aria-hidden="true" />
            <span aria-live="polite">Borrador recuperado (local)</span>
          </>
        )
      case 'error':
        return (
          <>
            <span className="w-2 h-2 rounded-full bg-rose-500" aria-hidden="true" />
            <span aria-live="polite">Error al guardar</span>
          </>
        )
      case 'publicado':
        return (
          <>
            <span className="w-2 h-2 rounded-full bg-emerald-600 shadow-[0_0_8px_rgba(5,150,105,0.6)]" aria-hidden="true" />
            <span aria-live="polite" className="font-bold text-emerald-700">Agenda publicada</span>
          </>
        )
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 p-3 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
        {/* Header Superior - Wireframe US-03 web & mobile */}
        <header className="flex items-center justify-between gap-4 pb-2 sm:pb-3 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <a
              href="/"
              title="Volver al portal principal"
              className="w-9 h-9 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-700 hover:text-black hover:bg-slate-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </a>

            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500 font-bold block">
                Disponibilidad Mensual
              </span>
              <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-slate-900">
                Definir Disponibilidad Mensual
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm">
            <div className="text-right">
              <span className="text-xs font-bold text-slate-900 block leading-tight">
                {medico.nombre}
              </span>
              <span className="text-[10px] font-mono text-slate-500 block leading-tight">
                ESP: {medico.especialidad}
              </span>
            </div>
            <div className="w-8 h-8 rounded border border-slate-300 bg-slate-100 flex items-center justify-center text-slate-700">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>
          </div>
        </header>

        {/* Barra de Navegación de Vistas y Selector de Mes */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex bg-slate-200/80 p-1 rounded-xl border border-slate-200 self-start">
            <button
              type="button"
              onClick={() => setTab('disponibilidad')}
              className={`px-3.5 py-1.5 text-xs font-mono font-bold rounded-lg transition-all ${
                tab === 'disponibilidad'
                  ? 'bg-black text-white shadow-sm'
                  : 'text-slate-700 hover:text-black'
              }`}
            >
              Configurar Horarios
            </button>

            <button
              type="button"
              onClick={() => setTab('agenda')}
              className={`px-3.5 py-1.5 text-xs font-mono font-bold rounded-lg transition-all ${
                tab === 'agenda'
                  ? 'bg-black text-white shadow-sm'
                  : 'text-slate-700 hover:text-black'
              }`}
            >
              Agenda y Calendario
            </button>
          </div>

          <MonthSelector
            currentMonth={currentMonth}
            onChangeMonth={(m) => {
              if (esMesPasado(m)) return
              setCurrentMonth(m)
            }}
            minMonth={getMesActual()}
          />
        </div>

        {/* Mensajes de Alerta */}
        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2 font-mono">
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2 font-mono">
            <span>{successMessage}</span>
          </div>
        )}

        {/* PESTAÑA 1: CONFIGURAR DISPONIBILIDAD */}
        {tab === 'disponibilidad' && (
          <div className="space-y-4 sm:space-y-5">
            <DaySelector
              selectedDays={selectedDays}
              onToggleDay={handleToggleDay}
            />

            <div className="space-y-3.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-mono font-bold tracking-wider text-slate-500 uppercase">
                  Configuración de Franjas
                </span>
              </div>

              {shifts.length === 0 ? (
                <div className="p-8 text-center bg-white border border-dashed border-slate-300 rounded-xl">
                  <p className="text-xs text-slate-500 font-mono">
                    No hay días seleccionados. Selecciona hasta 2 días semanales arriba para definir tus franjas de atención.
                  </p>
                </div>
              ) : (
                shifts.map((shift, idx) => (
                  <ShiftConfigCard
                    key={shift.diaSemana}
                    dia={shift.diaSemana}
                    franjaNumero={idx + 1}
                    horaDesde={shift.horaDesde}
                    horaHasta={shift.horaHasta}
                    duracion={shift.duracion}
                    onChange={(fields) => handleUpdateShift(shift.diaSemana, fields)}
                    onRemove={() => handleRemoveShift(shift.diaSemana)}
                  />
                ))
              )}
            </div>

            {shifts.length > 0 && (
              <div className="bg-slate-100 border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono">
                <div>
                  <div className="text-lg sm:text-xl font-bold text-slate-900">
                    {resumenEnVivo.totalJornadas} Jornadas
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    {resumenEnVivo.descripcionDias || 'Sin jornadas'}
                  </div>
                </div>

                <div className="text-left sm:text-right">
                  <div className="text-xl sm:text-2xl font-black text-slate-900">
                    {resumenEnVivo.totalTurnos} <span className="text-xs font-bold text-slate-600 uppercase">Turnos</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Cupos totales estimados para el mes
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-600 min-w-[220px]">
                {renderStatusIndicator()}
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onClick={handleGuardarBorrador}
                  disabled={saveStatus === 'guardando' || shifts.length === 0}
                  className="w-full sm:w-auto px-4 py-2.5 text-xs font-mono font-bold text-slate-800 hover:text-black bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-300 transition-colors disabled:opacity-50"
                >
                  GUARDAR REMOTO
                </button>

                <button
                  type="button"
                  onClick={handleRevisarYPublicar}
                  disabled={shifts.length === 0 || saveStatus === 'guardando' || isOffline}
                  className="w-full sm:w-auto px-5 py-2.5 text-xs font-mono font-bold text-white bg-black hover:bg-slate-800 rounded-lg transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span>CONFIRMAR Y PUBLICAR AGENDA</span>
                  <span>&rarr;</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'agenda' && (
          <CalendarView
            currentMonth={currentMonth}
            turnos={turnosPublicados}
            isLoading={isLoadingTurnos}
          />
        )}

        <PublishModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onConfirm={handleConfirmarPublicacion}
          resumen={resumenPublicacion}
          medicoNombre={medico.nombre}
          medicoEspecialidad={medico.especialidad}
          isPublishing={isPublishing}
          error={publishError}
        />

      </div>
    </div>
  )
}
