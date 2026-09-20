{
  description = "Relay Agent Chat dev shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      each = f: builtins.listToAttrs (map (s: { name = s; value = f s; }) systems);
    in
    {
      devShells = each (system:
        let pkgs = import nixpkgs { inherit system; };
        in pkgs.mkShell {
          packages = [ pkgs.nodejs_20 pkgs.git pkgs.cocoapods ];
          shellHook = ''
            echo "relay dev shell (node $(node --version))"
          '';
        });
    };
}
