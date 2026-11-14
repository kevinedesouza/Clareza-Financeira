-- Políticas do bucket privado de extratos: cada usuário só acessa a pasta com o próprio id (ownerId/batchId/arquivo)
drop policy if exists clareza_extratos_select_own on storage.objects;
create policy clareza_extratos_select_own on storage.objects for select to authenticated
  using (bucket_id = 'clareza-extratos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists clareza_extratos_insert_own on storage.objects;
create policy clareza_extratos_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'clareza-extratos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists clareza_extratos_delete_own on storage.objects;
create policy clareza_extratos_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'clareza-extratos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Funções SECURITY DEFINER não devem ser chamáveis por anon (rpc_create_transfer já exige auth.uid())
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.rpc_create_transfer(text, text, uuid, uuid, bigint, date, text) from public, anon;
grant execute on function public.rpc_create_transfer(text, text, uuid, uuid, bigint, date, text) to authenticated;
