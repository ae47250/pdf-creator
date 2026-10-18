"""Measure PDFs with pdfplumber; optionally compare service output to references/baseline."""
import argparse
import json
import logging
from pathlib import Path
import pdfplumber

logging.getLogger('pdfminer').setLevel(logging.ERROR)


def measure(path):
    with pdfplumber.open(path) as pdf:
        text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
        return {
            'pages': len(pdf.pages),
            'sizes': sorted({(round(page.width), round(page.height)) for page in pdf.pages}),
            'leftPage2': round(min(char['x0'] for char in pdf.pages[1].chars), 4) if len(pdf.pages) > 1 else None,
            'page1Footer': 'Page 1 of' in text,
            'page2Footer': 'Page 2 of' in text,
            'textPositions': [[(char['text'], round(char['x0'], 4), round(char['top'], 4)) for char in page.chars] for page in pdf.pages],
        }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--references', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    expected = {'generic_flowing_fixture', 'test1_annual_financial_report',
                'test2_program_outcomes_review', 'test3_rendering_torture_test'}
    missing = [name for name in sorted(expected) if not (args.directory / f'{name}.pdf').is_file()]
    if missing:
        parser.error(f'Missing required PDFs in {args.directory}: {missing}')
    results = {path.stem: measure(path) for path in sorted(args.directory.glob('*.pdf'))}
    failures = []
    for name, result in results.items():
        if args.references and name.startswith('test'):
            reference = measure(args.references / f'{name}.pdf')
            for field, ok in {
                'pages': abs(result['pages'] - reference['pages']) <= 2,
                'sizes': result['sizes'] == reference['sizes'],
                'leftPage2': abs(result['leftPage2'] - reference['leftPage2']) <= 3,
            }.items():
                if not ok:
                    failures.append(f'{name}: {field}: {result[field]} vs reference {reference[field]}')
            if name.startswith('test1') and not result['page2Footer']:
                failures.append(f'{name}: missing Page 2 of')
        if args.baseline and name == 'generic_flowing_fixture':
            baseline = measure(args.baseline / f'{name}.pdf')
            if result != baseline:
                failures.append(f'{name}: differs from baseline (including every text position)')
    if args.output:
        args.output.write_text(json.dumps(results, indent=2))
    print(json.dumps({name: {key: value for key, value in result.items() if key != 'textPositions'} for name, result in results.items()}, indent=2))
    print(json.dumps({'failures': failures}, indent=2))
    raise SystemExit(bool(failures))
