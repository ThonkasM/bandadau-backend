-- Fecha de la suspensión vigente (User.suspendedAt, contrato identity 1.4.0). Se rellena al suspender y se limpia al reactivar.
ALTER TABLE users ADD COLUMN suspended_at TIMESTAMPTZ;
-- Cuentas ya suspendidas antes de esta migración: la mejor aproximación es la última modificación.
UPDATE users SET suspended_at = updated_at WHERE status = 'SUSPENDED';
