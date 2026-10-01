# Morphing Rivers

An interactive prototype that shows Victorian river-monitoring networks as
station-level schematics, and morphs between the schematic and a geographic map.

Live: https://shaoyujie07-syj.github.io/morphing-rivers/

## What this is

This is a research prototype built for a Master's minor thesis (FIT5128,
Monash University, 2026). It is not an operational tool and is not maintained.
Figures and numbers shown here are derived for research purposes and should not
be used for water management decisions.

Four basins are included: Goulburn, Yarra, Campaspe and Werribee. Only
currently active monitoring sites are shown; discontinued sites are excluded and
counted separately.

## Data sources and licences

| Source | Used for | Licence |
|---|---|---|
| [Geofabric V3.3](http://www.bom.gov.au/water/geofabric/) (Bureau of Meteorology) | River network, catchment areas, water bodies | CC BY 4.0 |
| [Water Measurement Information System](https://data.water.vic.gov.au/) (DEECA, Victoria) | Monitoring sites, water quality and flow records | CC BY 4.0, see note below |
| [SILO](https://www.longpaddock.qld.gov.au/silo/) (Queensland Government) | Gridded daily rainfall | CC BY 4.0 |
| [Environment Reference Standard](https://www.epa.vic.gov.au/) (EPA Victoria, 2020) | Objective values and water segments | CC BY 4.0 |
| [GeoNames](https://www.geonames.org/) | Town names on the map view | CC BY 4.0 |
| [D3](https://d3js.org/) | Rendering | ISC, see `lib/d3-LICENSE.txt` |

Attribution: © State of Victoria (Department of Energy, Environment and Climate
Action); © Commonwealth of Australia (Bureau of Meteorology); © State of
Queensland; GeoNames, CC BY.

### Note on WMIS records

Some records in the Water Measurement Information System are supplied by partner
organisations of the Regional Water Monitoring Partnership rather than by DEECA
itself (quality code 65). WMIS publishes its material under CC BY 4.0 with the
exception of content supplied by third parties, for which the third party's
permission may be required. The records here are reproduced for research
purposes with attribution. If you are a data custodian and would like a record
removed, please contact the author.

Data snapshot: 2026-09-20 (sites and water quality), 2016–2026 (daily means).

## Scope and known limitations

- Tributary lengths are drawn to real channel distance; sites may be pushed
  along the line to stay legible, by up to 27 km in Campaspe. Read distances
  from the tooltips and cards, not from the picture.
- Line width shows the order of magnitude of catchment area, not a proportion.
- Sites are placed on the nearest river reach; registered coordinates are used
  as supplied, without converting by datum label, so a few sites carry roughly
  200 m of positional uncertainty.
- Rainfall is interpolated from gauge records, not measured in each region.
- ERS objective lines are not drawn where the standard does not apply
  (reservoir head gauges, non-natural watercourses) or where the segment could
  not be determined; the card says which.

Method notes for every derived value are available inside the prototype, under
"Data sources & site selection".

## Author

Yujie Shao, Faculty of Information Technology, Monash University.
Supervised by Sarah Goodwin and Anna Lintern.
