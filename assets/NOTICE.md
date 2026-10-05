# Earth background image

`earth-day.jpg` is NASA's Blue Marble land-surface, shallow-water and shaded-
topography map, downloaded without alteration from:

https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg

Source and credit: NASA Goddard Space Flight Center / NASA Visible Earth.
NASA's Blue Marble credits identify Reto Stöckli for land surface and shallow
water, Robert Simmon for ocean color and compositing, and the MODIS teams for
data and technical support. Topography incorporates USGS data.

Related NASA source description and credits:
https://science.nasa.gov/resource/blue-marble/

NASA imagery-use guidance:
https://www.nasa.gov/nasa-brand-center/images-and-media/

NASA makes this material available for informational use without explicit
permission, with NASA acknowledged as its source. The background is a graphical
visualization and does not imply NASA endorsement of Prospect AI. No NASA logo
or identifiable person is included.

Technical details: 2048 × 1024 pixels, JPEG, 238,676 bytes, geographic
equirectangular projection. Longitude runs from −180° at the left edge to +180°
at the right edge; latitude runs from +90° at the top to −90° at the bottom.
The equator is halfway down the image. The image is self-hosted by the app;
viewing the globe does not contact a NASA service.

## Night lights

`earth-night.jpg` is a size-optimized copy of NASA Earth Observatory's Black
Marble global night-light map for 2016. It contains genuine satellite observations
from the NASA/NOAA Suomi NPP Visible Infrared Imaging Radiometer Suite (VIIRS).
It is decorative historical imagery, not a live measurement of activity.

NASA source page (including the download and data description):
https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/

Original image:
https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_01deg.jpg

Credit: NASA Earth Observatory / NASA / NOAA. The NASA imagery-use guidance
linked above also applies to this image.

The original 3600 × 1800 JPEG was downsampled with a Lanczos filter to 2048 ×
1024 pixels and re-encoded as optimized JPEG at quality 86. File size: 159,534
bytes. The geographic equirectangular projection and world extent are unchanged
and match `earth-day.jpg`. No lights were added or moved. This image is also
self-hosted by the app.

## High-resolution daytime surface

`earth-day-desktop.jpg` is the NASA Blue Marble: Next Generation June 2004
global land-surface and topography mosaic (without a bathymetry overlay). The original 5400 × 2700
JPEG was downsampled with a Lanczos filter to 4096 × 2048 pixels and re-encoded
as optimized JPEG at quality 86. File size: 828,487 bytes. This is genuine
satellite-derived geography rather than an enlarged copy of the mobile map.
The existing `earth-day.jpg` remains the smaller mobile texture.

NASA source catalog:
https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography/

Original June 2004 image:
https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography/june/world.topo.200406.3x5400x2700.jpg

Credit: NASA Earth Observatory / NASA Goddard Space Flight Center, Blue Marble:
Next Generation. The NASA imagery-use guidance linked above applies. The
desktop and mobile mosaics have different historical acquisition dates; neither
is a live satellite image. No continents or geographic extents were moved.

## Clouds

`earth-clouds.webp` and `earth-clouds-desktop.webp` use the genuine NASA Blue
Marble global cloud mosaic, downloaded from:

https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg

Credit: NASA Goddard Space Flight Center / NASA Visible Earth; Blue Marble
cloud observations and compositing. Related description and credits:
https://science.nasa.gov/resource/blue-marble/

Both are 2048 × 1024 RGBA WebP images. The source grayscale intensity becomes
alpha (zero is transparent, 255 is opaque); RGB is white so the renderer can
light the clouds separately. No cloud systems were drawn or repositioned.
WebP encoding uses quality 85 and alpha quality 25 for the mobile image
(306,098 bytes), or alpha quality 65 for the desktop image (519,540 bytes).
These are lossy decorative textures: alpha levels are quantized for compression,
not a measurement product. They preserve the geographic positions of the cloud
patterns. This historical cloud mosaic is not current weather information.

## Ocean reflection mask

`earth-specular.jpg` is derived from Natural Earth's public-domain 1:10 million
land/coastline vector dataset, version 5.1.1. It is a material mask for the
decorative globe and is never used to determine company-search boundaries.
White is ocean (reflective); black is land (matte). Inland lakes remain matte.

Source download:
https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip

Dataset description:
https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-land/

Public-domain usage terms:
https://www.naturalearthdata.com/about/terms-of-use/

Credit: Natural Earth; primary authors Tom Patterson and Nathaniel Vaughn Kelso,
with the Natural Earth contributors. The dataset permits use and modification
without restriction. No external provider is contacted when viewing the mask.

Preparation: fill clockwise exterior ESRI Polygon rings in black over a white
4096 × 2048 geographic canvas; retain interior rings as matte land; reduce with
a Lanczos filter to 2048 × 1024 and encode as optimized grayscale JPEG at
quality 90. File size: 185,454 bytes. This uses actual coastline geometry, not
an inference based on the colors of the daytime image.

All new maps share the original geographic equirectangular orientation: −180°
to +180° longitude from left to right and +90° to −90° latitude from top to
bottom. Desktop texture payload (4096 daytime, desktop clouds, night lights and
reflection mask): 1,693,015 bytes. Mobile texture payload (original 2048 daytime,
mobile clouds, night lights and reflection mask): 889,762 bytes.

## Three.js

The renderer uses `three@0.180.0`, licensed under MIT. The original copyright
headers are retained in the self-hosted JavaScript modules. The installed
package includes the complete license, also served at `/vendor/three.LICENSE.txt`:

The MIT License

Copyright © 2010-2025 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
