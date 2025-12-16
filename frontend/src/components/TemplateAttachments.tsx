import React from 'react'
import { useAuth } from '../hooks/useAuth'

type Props = {
  communityId: string
  periodCode: string
  templateCode: string
  templateType: 'BILL' | 'METER'
  canEdit?: boolean
}

export function AttachmentPane({ communityId, periodCode, templateCode, templateType, canEdit = true }: Props) {
  const { api } = useAuth()
  const [files, setFiles] = React.useState<Array<{ id: string; fileName: string; size?: number; createdAt?: string }>>([])
  const [message, setMessage] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const refresh = React.useCallback(() => {
    setMessage(null)
    api
      .get<any[]>(`/communities/${communityId}/periods/${periodCode}/${templateType === 'BILL' ? 'bill' : 'meter'}-templates/${templateCode}/attachments`)
      .then((rows) => setFiles(rows || []))
      .catch((err: any) => setMessage(err?.message || 'Failed to load attachments'))
  }, [api, communityId, periodCode, templateCode, templateType])

  React.useEffect(() => {
    if (!communityId || !periodCode || !templateCode) return
    refresh()
  }, [communityId, periodCode, templateCode, refresh])

  const handleUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    if (!ev.target.files || !ev.target.files.length) return
    const file = ev.target.files[0]
    const form = new FormData()
    form.append('file', file)
    setUploading(true)
    setMessage(null)
    try {
      await api.post(
        `/communities/${communityId}/periods/${periodCode}/${templateType === 'BILL' ? 'bill' : 'meter'}-templates/${templateCode}/attachments`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      refresh()
    } catch (err: any) {
      setMessage(err?.message || 'Failed to upload')
    } finally {
      setUploading(false)
      ev.target.value = ''
    }
  }

  const handleDelete = async (id: string) => {
    setMessage(null)
    try {
      await api.del(
        `/communities/${communityId}/periods/${periodCode}/${templateType === 'BILL' ? 'bill' : 'meter'}-templates/${templateCode}/attachments/${id}`,
      )
      refresh()
    } catch (err: any) {
      setMessage(err?.message || 'Failed to delete')
    }
  }

  const handleDownload = async (id: string) => {
    setMessage(null)
    try {
      const res: { fileName: string; contentType?: string; data: string } = await api.get(
        `/communities/${communityId}/periods/${periodCode}/${templateType === 'BILL' ? 'bill' : 'meter'}-templates/${templateCode}/attachments/${id}/download`,
      )
      if (!res?.data) {
        setMessage('Empty attachment')
        return
      }
      const byteString = atob(res.data)
      const bytes = new Uint8Array(byteString.length)
      for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i)
      const blob = new Blob([bytes], { type: res.contentType || 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.fileName || 'attachment'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setMessage(err?.message || 'Failed to download')
    }
  }

  return (
    <div className="card soft" style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>Attachments</h4>
        {canEdit && (
          <label className="btn secondary" style={{ cursor: uploading ? 'not-allowed' : 'pointer' }}>
            {uploading ? 'Uploading…' : 'Upload'}
            <input type="file" style={{ display: 'none' }} onChange={handleUpload} disabled={uploading} />
          </label>
        )}
      </div>
      {message && <div className="badge negative" style={{ marginTop: 6 }}>{message}</div>}
      {files.length === 0 ? (
        <div className="muted" style={{ marginTop: 6 }}>No attachments</div>
      ) : (
        <ul className="muted" style={{ marginTop: 6, paddingLeft: 16 }}>
          {files.map((f) => (
            <li key={f.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span>{f.fileName}</span>
              {typeof f.size === 'number' && <span className="muted" style={{ fontSize: 12 }}>({Math.round(f.size / 1024)} KB)</span>}
              <button className="btn tertiary" type="button" onClick={() => handleDownload(f.id)}>
                Download
              </button>
              {canEdit && (
                <button className="btn tertiary" type="button" onClick={() => handleDelete(f.id)}>
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
