-- Usuarios de prueba para desarrollo local (uno por rol).
-- El trigger on_auth_user_created ya crea el perfil, por eso profiles usa ON CONFLICT.
DO $$
DECLARE
  _u RECORD;
  _uid UUID;
BEGIN
  FOR _u IN
    SELECT * FROM (VALUES
      ('admin@test.com',      'Admin1234',      'Admin Local',      'admin'::public.app_role),
      ('vendedor@test.com',   'Vendedor1234',   'Vendedor Local',   'vendedor'::public.app_role),
      ('produccion@test.com', 'Produccion1234', 'Producción Local', 'produccion'::public.app_role)
    ) AS t(email, password, full_name, role)
  LOOP
    SELECT id INTO _uid FROM auth.users WHERE email = _u.email;

    IF _uid IS NULL THEN
      _uid := gen_random_uuid();
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
      ) VALUES (
        '00000000-0000-0000-0000-000000000000', _uid, 'authenticated', 'authenticated',
        _u.email, crypt(_u.password, gen_salt('bf')),
        now(), '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', _u.full_name),
        now(), now(), '', '', '', ''
      );
      INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
      VALUES (gen_random_uuid(), _uid, jsonb_build_object('sub', _uid::text, 'email', _u.email),
              'email', _uid::text, now(), now(), now());
    END IF;

    INSERT INTO public.profiles (id, email, full_name)
    VALUES (_uid, _u.email, _u.full_name)
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (_uid, _u.role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END LOOP;
END $$;
