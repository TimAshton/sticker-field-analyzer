# --- Custom domain: stickers.tashton.com ---
# Adds an alias + ACM cert to the *existing* CloudFront distribution (cdn, in
# main.tf) so the app is reachable at a friendly URL. Deliberately a
# subdomain, not a path (tashton.com/stickers): DNS can't split traffic by
# path, so a path would require rebuilding tashton.com's whole front door
# (which lives in the separate tashton.com-aws repo, currently a bare,
# unencrypted S3-website-hosted landing page with no CloudFront/ACM at all).
# This only adds records inside the existing tashton.com hosted zone - it
# never takes ownership of the zone or touches tashton.com-aws's resources.

data "aws_route53_zone" "tashton" {
  name         = "tashton.com."
  private_zone = false
}

resource "aws_acm_certificate" "stickers" {
  provider          = aws.us_east_1
  domain_name       = "stickers.tashton.com"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "stickers_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.stickers.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = data.aws_route53_zone.tashton.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "stickers" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.stickers.arn
  validation_record_fqdns = [for r in aws_route53_record.stickers_cert_validation : r.fqdn]
}

resource "aws_route53_record" "stickers_alias" {
  zone_id = data.aws_route53_zone.tashton.zone_id
  name    = "stickers.tashton.com"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.cdn.domain_name
    zone_id                = aws_cloudfront_distribution.cdn.hosted_zone_id
    evaluate_target_health = false
  }
}

output "stickers_domain_url" {
  value       = "https://stickers.tashton.com"
  description = "Custom domain the web app is reachable at, once DNS/cert propagate"
}
