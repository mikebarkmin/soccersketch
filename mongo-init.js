db.createUser({
  user: 'server',
  pwd: 'test',
  roles: [
    {
      role: 'readWrite',
      db: 'soccersketch'
    }
  ]
});
