"""Build a WGT for signing and installation on the TV."""
from pathlib import Path
import json
import os
import re
from urllib.parse import urlsplit
from zipfile import ZipFile, ZIP_DEFLATED
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent

def main():
    # Use the widget manifest as the source of the installable version.
    version = ET.parse(ROOT / 'config.xml').getroot().attrib['version']
    portfolio_url = os.environ.get('FRAME_PORTFOLIO_URL')
    portfolio_token = os.environ.get('FRAME_PORTFOLIO_TOKEN')
    streamforge_url = os.environ.get('FRAME_STREAMFORGE_URL')
    if streamforge_url:
        streamforge = urlsplit(streamforge_url)
        if streamforge.scheme != 'https' or not re.fullmatch(r'[A-Za-z0-9.-]+(?::[0-9]+)?', streamforge.netloc):
            raise ValueError('Set an HTTPS StreamForge URL without embedded credentials.')
    portfolio_origin = None
    # A paired build needs both settings to pass validation.
    if portfolio_url or portfolio_token:
        parsed = urlsplit(portfolio_url or '')
        if (parsed.scheme != 'https' or not re.fullmatch(r'[A-Za-z0-9.-]+(?::[0-9]+)?', parsed.netloc)
                or parsed.path != '/portfolio' or parsed.query or parsed.fragment
                or not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', portfolio_token or '')):
            raise ValueError('Set an HTTPS /portfolio URL and a valid display-only token.')
        portfolio_origin = f'{parsed.scheme}://{parsed.netloc}'
    # Package the frontend, manifest, and assets. Tests and local configuration stay outside the WGT.
    files = [ROOT / name for name in ('config.xml', 'index.html', 'styles.css', 'edition.css')]
    for directory, extensions in (('assets', {'.png', '.svg'}), ('js', {'.js'})):
        for file in sorted((ROOT / directory).rglob('*')):
            if file.suffix in extensions and not any(part.startswith('.') for part in file.relative_to(ROOT).parts):
                files.append(file)
    suffix = 'private-unsigned' if portfolio_origin or streamforge_url else 'unsigned'
    target = ROOT / 'dist' / f'Frame-{version}-{suffix}.wgt'
    target.parent.mkdir(exist_ok=True)
    with ZipFile(target, 'w', ZIP_DEFLATED) as package:
        for file in files:
            if file.is_file():
                relative = file.relative_to(ROOT).as_posix()
                # Permit the paired HTTPS origin in both the browser policy and Tizen manifest.
                if portfolio_origin and relative == 'index.html':
                    html = file.read_text(encoding='utf-8').replace('connect-src ', f'connect-src {portfolio_origin} ', 1)
                    package.writestr(relative, html)
                elif portfolio_origin and relative == 'config.xml':
                    manifest = file.read_text(encoding='utf-8').replace('</widget>', f'  <access origin="{portfolio_origin}"/>\n</widget>')
                    package.writestr(relative, manifest)
                # Write a fresh configuration so a public package cannot inherit a local display token.
                elif relative == 'js/portfolio-config.js':
                    if portfolio_origin:
                        config = json.dumps({'url': portfolio_url, 'token': portfolio_token})
                        package.writestr(relative, f'window.FramePortfolioConfig = {config};\n')
                    else:
                        package.writestr(relative, '// Portfolio display is provisioned at packaging time.\n')
                elif relative == 'js/launcher-config.js':
                    if streamforge_url:
                        settings = json.dumps({'streamForgeUrl': streamforge_url})
                        package.writestr(relative, f'window.FrameLauncherConfig = {settings};\n')
                    else:
                        package.writestr(relative, '// No private shortcut settings were supplied.\n')
                else:
                    package.write(file, relative)
        # Bundle the lightweight HLS runtime and its license.
        hls = ROOT / 'node_modules' / 'hls.js'
        package.write(hls / 'dist' / 'hls.light.min.js', 'js/hls.light.min.js')
        package.write(hls / 'LICENSE', 'js/hls.js.LICENSE.txt')
    print(f'Unsigned review package: {target}')
    print('Sign the package before installation.')

if __name__ == '__main__':
    main()
