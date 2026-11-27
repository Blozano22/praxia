-- Cola de «regenerar» por partes: partes (null = todo el recurso) e imagenes (rutas elegidas; null = solo las que faltan). Idempotente.
ALTER TABLE regenerar_cola ADD COLUMN IF NOT EXISTS partes jsonb;
ALTER TABLE regenerar_cola ADD COLUMN IF NOT EXISTS imagenes jsonb;
