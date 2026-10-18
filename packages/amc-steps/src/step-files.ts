import type { ConfigurationStep, DownloadFile, UploadFile } from './types.js'

/** One file a step puts on the flight controller, and where it comes from. */
export interface StepFile {
  /** Where to fetch it; absent when no download in the step produces it. */
  readonly url?: string
  /** Its name locally, which is what ties an upload to its download. */
  readonly name: string
  /** Where it goes on the flight controller. */
  readonly destination: string
}

const asList = <T>(value: T | readonly T[] | undefined): readonly T[] =>
  value === undefined ? [] : Array.isArray(value) ? (value as readonly T[]) : [value as T]

/**
 * The files a step installs, whichever shape the step file uses.
 *
 * AMC v4.5.x let download_file and upload_file be a list as well as a single
 * object, and normalizes both to lists on load (get_download_files and
 * get_upload_files). This is the same normalization, plus the pairing the
 * install needs: an upload names a LOCAL file, and the download whose
 * dest_local matches it is where that file comes from.
 *
 * An upload with no matching download is still returned, without a url,
 * rather than dropped -- a file the step needs and nothing here can fetch is
 * something the operator has to be told about.
 */
export function stepFiles(step: ConfigurationStep): readonly StepFile[] {
  const downloads: readonly DownloadFile[] = asList(step.download_file)
  const uploads: readonly UploadFile[] = asList(step.upload_file)
  return uploads.map((upload) => {
    const source = downloads.find((download) => download.dest_local === upload.source_local)
    return {
      ...(source ? { url: source.source_url } : {}),
      name: upload.source_local,
      destination: upload.dest_on_fc
    }
  })
}
