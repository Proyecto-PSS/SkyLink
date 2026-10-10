import { DiaSemana, DuracionTurno } from '../types/agenda'

export interface ShiftDraft {
  id?: string
  diaSemana: DiaSemana
  horaDesde: string
  horaHasta: string
  duracion: DuracionTurno
}

export interface AvailabilityDraft {
  version: 'v1'
  mes: string
  idMedico: string
  shifts: ShiftDraft[]
  updatedAt: string
}

const DRAFT_PREFIX = 'SIGESMED:US19:availability:v1'

export function getDraftKey(idMedico: string, mes: string): string {
  if (!idMedico || !mes) return ''
  return `${DRAFT_PREFIX}:${idMedico}:${mes}`
}

export function saveDraft(idMedico: string, mes: string, shifts: ShiftDraft[]): boolean {
  try {
    const key = getDraftKey(idMedico, mes)
    if (!key) return false

    const draft: AvailabilityDraft = {
      version: 'v1',
      mes,
      idMedico,
      shifts,
      updatedAt: new Date().toISOString(),
    }
    
    window.localStorage.setItem(key, JSON.stringify(draft))
    return true
  } catch (err) {
    console.error('Error saving availability draft', err)
    return false
  }
}

export function loadDraft(idMedico: string, mes: string): AvailabilityDraft | null {
  try {
    const key = getDraftKey(idMedico, mes)
    if (!key) return null

    const data = window.localStorage.getItem(key)
    if (!data) return null

    const parsed = JSON.parse(data)
    
    if (
      parsed.version !== 'v1' || 
      parsed.idMedico !== idMedico || 
      parsed.mes !== mes || 
      !Array.isArray(parsed.shifts)
    ) {
      return null
    }

    const validShifts = parsed.shifts.filter((s: any) => {
      const isDiaSemanaValid = [1, 2, 3, 4, 5, 6].includes(s.diaSemana)
      const isDuracionValid = [20, 30, 45].includes(s.duracion)
      const isHoraDesdeValid = typeof s.horaDesde === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(s.horaDesde)
      const isHoraHastaValid = typeof s.horaHasta === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(s.horaHasta)
      return isDiaSemanaValid && isDuracionValid && isHoraDesdeValid && isHoraHastaValid && s.horaDesde < s.horaHasta
    })

    return {
      version: parsed.version,
      mes: parsed.mes,
      idMedico: parsed.idMedico,
      shifts: validShifts,
      updatedAt: parsed.updatedAt
    }
  } catch (err) {
    console.error('Error loading availability draft', err)
    return null
  }
}

export function clearDraft(idMedico: string, mes: string): boolean {
  try {
    const key = getDraftKey(idMedico, mes)
    if (!key) return false
    window.localStorage.removeItem(key)
    return true
  } catch (err) {
    console.error('Error clearing availability draft', err)
    return false
  }
}

export function checkConnectivity(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}

export function compareShifts(a: ShiftDraft[], b: ShiftDraft[]): boolean {
  if (a.length !== b.length) return false
  
  const sortedA = [...a].sort((x, y) => x.diaSemana - y.diaSemana)
  const sortedB = [...b].sort((x, y) => x.diaSemana - y.diaSemana)
  
  for (let i = 0; i < sortedA.length; i++) {
    const sa = sortedA[i]
    const sb = sortedB[i]
    if (
      sa.diaSemana !== sb.diaSemana ||
      sa.horaDesde !== sb.horaDesde ||
      sa.horaHasta !== sb.horaHasta ||
      sa.duracion !== sb.duracion
    ) {
      return false
    }
  }
  return true
}
