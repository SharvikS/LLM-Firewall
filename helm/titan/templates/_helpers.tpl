{{- define "titan.fullname" -}}
{{- .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- end -}}

{{- define "titan.labels" -}}
app.kubernetes.io/part-of: titan
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
titan/region: {{ .Values.region | quote }}
{{- end -}}

{{- define "titan.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{ .Values.secrets.existingSecret }}
{{- else -}}
{{ include "titan.fullname" . }}-secrets
{{- end -}}
{{- end -}}
