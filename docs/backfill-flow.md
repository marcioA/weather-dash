# Fluxo de Backfill — Backend × Open-Meteo

```mermaid
sequenceDiagram
    actor Client
    participant Controller as LightningController<br/>POST /lightning/backfill
    participant Service as LightningService
    participant Meteo as Open-Meteo<br/>Archive API
    participant DB as MySQL<br/>lightning_strikes

    Client->>Controller: POST /lightning/backfill<br/>{ startDate, endDate }

    Controller->>Service: backfill(dto)

    loop Para cada cidade (15 no total — sequencial)
        Service->>Meteo: GET /v1/archive<br/>?latitude=...&longitude=...<br/>&start_date=...&end_date=...<br/>&hourly=weather_code

        Meteo-->>Service: { hourly: { time[], weather_code[] } }<br/>ex: 8 760 horas × 1 ano

        Service->>Service: Mapeia cada hora →<br/>{ lat, lon, occurrenceDate,<br/>  weatherCode, intensity, source }

        loop Chunks de 500 registros
            Service->>DB: INSERT IGNORE INTO lightning_strikes<br/>(500 linhas por vez)
            DB-->>Service: OK (duplicatas ignoradas)
        end

        Service->>Service: Aguarda 500 ms<br/>(evita rate limit 429)
    end

    Service-->>Controller: { processed, stored }
    Controller-->>Client: 200 OK<br/>{ horasProcessadas, eventosArmazenados }
```

## Detalhes do fluxo

| Etapa | Detalhe |
|-------|---------|
| **Fonte** | `archive-api.open-meteo.com` — dados ERA5, gratuito, sem chave de API |
| **Granularidade** | Horária — 1 registro por cidade por hora |
| **Cidades monitoradas** | 15 pontos distribuídos pelo Brasil |
| **Códigos salvos** | Todos os códigos WMO (0–99), sem filtro — frontend interpreta |
| **Intensidade (kA)** | Preenchida apenas para códigos de trovoada (95, 96, 99) |
| **Deduplicação** | `INSERT IGNORE` + índice único `(latitude, longitude, occurrenceDate)` |
| **Proteção 429** | Cidades processadas sequencialmente com 500 ms de intervalo |
| **Proteção timeout** | Inserções em chunks de 500 linhas — evita conexão longa com MySQL |
| **Re-execução** | Segura — registros existentes são ignorados, nenhum dado é sobrescrito |
```
