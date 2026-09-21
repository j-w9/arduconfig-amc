/**
 * What a step's directory usually holds that the sequence never decides.
 *
 * AMC seeds a vehicle directory by copying a template's `.param` files and
 * then lets the sequence edit them. This fork computes purely from the step
 * directives, so most of what an AMC directory contains is simply absent
 * here -- 69 of the 662 parameters in AMC's own `empty_4.6.x` ArduCopter
 * directory come from directives.
 *
 * Copying those values across would be wrong: `GPS_POS1_X` is one particular
 * aircraft's antenna offset, not this one's. What carries across honestly is
 * the *question* -- which parameters AMC's templates consistently set for a
 * step -- so the tab can say what the sequence does not decide rather than
 * leaving it unmentioned, and the operator can answer it from their own
 * vehicle.
 *
 * The count is evidence, not instruction. `BRD_SER1_RTSCTS` appears in 19 of
 * 21 ArduCopter templates and is plainly part of setting telemetry up;
 * `SERIAL4_BAUD` appears in one and is that aircraft's own business.
 */

/** `steps/template-only.json`, keyed by vehicle then step filename. */
export interface TemplateOnlyTable {
  readonly [vehicle: string]: {
    /** How many templates AMC ships for this vehicle. */
    readonly templates: number
    readonly steps: { readonly [filename: string]: { readonly [parameter: string]: number } }
  }
}

export interface TemplateOnlyParameter {
  readonly parameter: string
  /** How many of AMC's templates set it on this step. */
  readonly templates: number
  /** That count as a fraction of the templates available, 0 to 1. */
  readonly share: number
}

/**
 * How widely a parameter has to appear before it reads as part of the step
 * rather than as one aircraft's quirk.
 *
 * A third: enough that several unrelated builders all set it, low enough not
 * to lose the ones only the well-documented templates bother with. Nothing in
 * AMC fixes this number -- AMC never asks the question -- so it is a judgement
 * about what is worth an operator's attention, and callers can override it.
 */
export const COMMON_SHARE = 1 / 3

export interface TemplateOnlyOptions {
  /** Drop anything set by a smaller share of templates than this. */
  readonly minimumShare?: number
}

/**
 * The parameters AMC's templates set for a step that this sequence does not.
 *
 * Sorted by how many templates set them, so the near-universal ones come
 * first. Returns nothing for a vehicle or step the table does not cover,
 * rather than guessing.
 */
export function templateOnlyParameters(
  table: TemplateOnlyTable,
  vehicle: string,
  filename: string,
  options: TemplateOnlyOptions = {}
): readonly TemplateOnlyParameter[] {
  const entry = table[vehicle]
  if (!entry) return []
  const step = entry.steps[filename]
  if (!step || entry.templates === 0) return []

  const minimum = options.minimumShare ?? COMMON_SHARE
  return Object.entries(step)
    .map(([parameter, templates]) => ({
      parameter,
      templates,
      share: templates / entry.templates
    }))
    .filter((candidate) => candidate.share >= minimum)
    .sort((a, b) => b.templates - a.templates || a.parameter.localeCompare(b.parameter))
}

/**
 * Those of them the connected vehicle can answer.
 *
 * The honest way to fill these in: the operator's own aircraft already has a
 * value for most of them, and that value is a fact about this vehicle rather
 * than about whoever contributed the template.
 */
export function answerableFromVehicle(
  parameters: readonly TemplateOnlyParameter[],
  vehicle: Readonly<Record<string, number>>
): readonly { readonly parameter: string; readonly value: number }[] {
  return parameters
    .filter((candidate) => Object.hasOwn(vehicle, candidate.parameter))
    .map((candidate) => ({ parameter: candidate.parameter, value: vehicle[candidate.parameter] as number }))
}
