{pkgs}: {
  deps = [
    pkgs.libev
    pkgs.libxcrypt
    pkgs.postgresql
    pkgs.openssl
  ];
}
