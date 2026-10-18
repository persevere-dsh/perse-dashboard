/** Owner-only task evidence read, constrained to registered workspace images. */
import { realpath, open } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import type { Task } from '../contract/types.ts'
export async function evidenceImage(
  task: Task,
  workspace: string,
  relative: string,
) {
  if (!task.images.some((image) => image.path === relative))
    throw Error('Image is not recorded on this task')
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..'))
    throw Error('Image must be inside the workspace')
  const root = await realpath(workspace),
    target = await realpath(path.join(root, relative))
  if (!target.startsWith(root + path.sep))
    throw Error('Image escapes the workspace')
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
      throw Error('Evidence must be a regular image up to 2 MiB')
    const buffer = Buffer.alloc(2 * 1024 * 1024 + 1)
    let length = 0
    while (length < buffer.length) {
      const read = await file.read(buffer, length, buffer.length - length, null)
      if (!read.bytesRead) break
      length += read.bytesRead
    }
    const bytes = buffer.subarray(0, length)
    const after = await file.stat()
    if (
      stat.size !== after.size ||
      stat.mtimeMs !== after.mtimeMs ||
      target !== (await realpath(path.join(root, relative)))
    )
      throw Error('Image changed during read')
    if (bytes.length > 2 * 1024 * 1024) throw Error('Image exceeds 2 MiB')
    const mime = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? 'image/jpeg'
        : bytes.toString('ascii', 0, 4) === 'RIFF' &&
            bytes.toString('ascii', 8, 12) === 'WEBP'
          ? 'image/webp'
          : null
    if (!mime)
      throw Error('Only PNG, JPEG and WebP image evidence is supported')
    return `data:${mime};base64,${bytes.toString('base64')}`
  } finally {
    await file.close()
  }
}
