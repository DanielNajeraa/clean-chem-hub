-- Core tables from the first migration were created without GRANTs for
-- authenticated/service_role. Without these, PostgREST returns
-- "permission denied for table user_roles" even when RLS policies exist.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Explicit for role lookup during/after auth
GRANT SELECT ON public.user_roles TO authenticated, anon, service_role;
GRANT SELECT ON public.profiles TO authenticated, anon, service_role;
GRANT INSERT, UPDATE, DELETE ON public.user_roles TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.profiles TO authenticated, service_role;
