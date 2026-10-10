import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  saveDraft,
  loadDraft,
  clearDraft,
  getDraftKey,
  compareShifts,
  ShiftDraft
} from '../lib/utils/availability-draft'

describe('US-19: LocalStorage Draft Management', () => {
  const mockIdMedico = 'med_123'
  const mockMes = '2026-10'

  const mockShifts: ShiftDraft[] = [
    { diaSemana: 1, horaDesde: '08:00', horaHasta: '12:00', duracion: 30 },
    { diaSemana: 3, horaDesde: '14:00', horaHasta: '18:00', duracion: 20 }
  ]

  beforeEach(() => {
    // Mock localStorage
    const store: Record<string, string> = {}
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => { store[key] = value },
        removeItem: (key: string) => { delete store[key] }
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('Generates correct keys for drafts', () => {
    const key = getDraftKey(mockIdMedico, mockMes)
    expect(key).toBe(`SIGESMED:US19:availability:v1:${mockIdMedico}:${mockMes}`)
  })

  it('Returns empty string for invalid key inputs', () => {
    expect(getDraftKey('', '2026-10')).toBe('')
    expect(getDraftKey('med_123', '')).toBe('')
  })

  it('Saves and loads a draft correctly', () => {
    const saved = saveDraft(mockIdMedico, mockMes, mockShifts)
    expect(saved).toBe(true)

    const draft = loadDraft(mockIdMedico, mockMes)
    expect(draft).not.toBeNull()
    expect(draft?.idMedico).toBe(mockIdMedico)
    expect(draft?.mes).toBe(mockMes)
    expect(draft?.version).toBe('v1')
    expect(draft?.shifts).toHaveLength(2)
    expect(draft?.shifts[0].diaSemana).toBe(1)
  })

  it('Clears a draft correctly', () => {
    saveDraft(mockIdMedico, mockMes, mockShifts)
    expect(loadDraft(mockIdMedico, mockMes)).not.toBeNull()

    const cleared = clearDraft(mockIdMedico, mockMes)
    expect(cleared).toBe(true)

    expect(loadDraft(mockIdMedico, mockMes)).toBeNull()
  })

  it('Validates shifts upon loading, dropping invalid ones', () => {
    const key = getDraftKey(mockIdMedico, mockMes)
    
    // Create corrupted data manually
    window.localStorage.setItem(key, JSON.stringify({
      version: 'v1',
      mes: mockMes,
      idMedico: mockIdMedico,
      shifts: [
        { diaSemana: 1, horaDesde: '08:00', horaHasta: '12:00', duracion: 30 }, // valid
        { diaSemana: 8, horaDesde: '14:00', horaHasta: '18:00', duracion: 20 }, // invalid day
        { diaSemana: 3, horaDesde: '25:00', horaHasta: '18:00', duracion: 20 }, // invalid time
        { diaSemana: 4, horaDesde: '10:00', horaHasta: '08:00', duracion: 20 }, // inverted time
        { diaSemana: 5, horaDesde: '10:00', horaHasta: '12:00', duracion: 99 }  // invalid duration
      ],
      updatedAt: new Date().toISOString()
    }))

    const draft = loadDraft(mockIdMedico, mockMes)
    expect(draft).not.toBeNull()
    expect(draft?.shifts).toHaveLength(1) // Only the first one is completely valid
    expect(draft?.shifts[0].diaSemana).toBe(1)
  })

  it('Compares shifts correctly regardless of order', () => {
    const a: ShiftDraft[] = [
      { diaSemana: 3, horaDesde: '14:00', horaHasta: '18:00', duracion: 20 },
      { diaSemana: 1, horaDesde: '08:00', horaHasta: '12:00', duracion: 30 }
    ]
    
    expect(compareShifts(mockShifts, a)).toBe(true)

    const b: ShiftDraft[] = [
      { diaSemana: 1, horaDesde: '08:00', horaHasta: '12:00', duracion: 30 }
    ]
    expect(compareShifts(mockShifts, b)).toBe(false)
  })
})
